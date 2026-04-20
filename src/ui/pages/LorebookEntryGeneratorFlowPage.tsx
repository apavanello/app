import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  Compass,
  FileText,
  Hash,
  History,
  Loader2,
  MessageSquareText,
  Search,
  Sparkles,
  Square,
  User as UserIcon,
  X,
  Zap,
} from "lucide-react";
import { TopNav } from "../components/App";
import { toast } from "../components/toast";
import type { Character, Lorebook, LorebookEntry, StoredMessage } from "../../core/storage/schemas";
import {
  createBlankLorebookEntry,
  listCharacters,
  listLorebooks,
  listMessages,
  listSessionPreviews,
  saveLorebookEntry,
  type SessionPreview,
} from "../../core/storage/repo";
import { generateLorebookEntryDraft, type LorebookEntryDraft } from "../../core/chat/manager";
import { Routes, useNavigationManager } from "../navigation";

type GeneratorContext =
  | {
      kind: "library";
      lorebookId: string;
      backPath: string;
      characterId: null;
      sessionId: null;
    }
  | {
      kind: "character";
      lorebookId: string;
      backPath: string;
      characterId: string;
      sessionId: string | null;
    };

type RoleFilter = "all" | "user" | "assistant";

interface DraftFormState {
  title: string;
  keywordsText: string;
  content: string;
  alwaysActive: boolean;
}

const MESSAGE_PAGE_LIMIT = 120;
const QUICK_RANGES = [10, 25, 50] as const;

function parseKeywordsInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
}

function buildDraftFormState(draft: LorebookEntryDraft): DraftFormState {
  return {
    title: draft.title,
    keywordsText: draft.keywords.join(", "),
    content: draft.content,
    alwaysActive: draft.alwaysActive,
  };
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function resolveContext(
  params: Readonly<Partial<Record<"characterId" | "lorebookId", string>>>,
  searchParams: URLSearchParams,
): GeneratorContext | null {
  if (params.lorebookId) {
    return {
      kind: "library",
      lorebookId: params.lorebookId,
      backPath: Routes.libraryLorebookGenerate(params.lorebookId).replace("/generate", ""),
      characterId: null,
      sessionId: null,
    };
  }
  if (params.characterId) {
    const lorebookId = searchParams.get("lorebookId");
    if (!lorebookId) return null;
    const sessionId = searchParams.get("sessionId");
    return {
      kind: "character",
      lorebookId,
      characterId: params.characterId,
      sessionId,
      backPath: (() => {
        const next = new URLSearchParams();
        next.set("lorebookId", lorebookId);
        if (sessionId) next.set("sessionId", sessionId);
        return `${Routes.characterLorebook(params.characterId)}?${next.toString()}`;
      })(),
    };
  }
  return null;
}

function formatRelative(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function roleMeta(role: StoredMessage["role"]): {
  label: string;
  icon: React.ReactNode;
  labelClass: string;
} {
  switch (role) {
    case "user":
      return {
        label: "USER",
        icon: <UserIcon className="h-3 w-3 text-accent/80" />,
        labelClass: "text-accent/85",
      };
    case "assistant":
      return {
        label: "AI",
        icon: <Bot className="h-3 w-3 text-info/80" />,
        labelClass: "text-info/85",
      };
    default:
      return {
        label: role.toUpperCase(),
        icon: <FileText className="h-3 w-3 text-fg/50" />,
        labelClass: "text-fg/60",
      };
  }
}

export function LorebookEntryGeneratorFlowPage() {
  const { backOrReplace } = useNavigationManager();
  const location = useLocation();
  const params = useParams<{ characterId?: string; lorebookId?: string }>();
  const [searchParams] = useSearchParams();
  const context = useMemo(() => resolveContext(params, searchParams), [params, searchParams]);

  const [lorebook, setLorebook] = useState<Lorebook | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [messages, setMessages] = useState<StoredMessage[]>([]);

  const [selectedCharacterId, setSelectedCharacterId] = useState(context?.characterId ?? "");
  const [selectedSessionId, setSelectedSessionId] = useState(context?.sessionId ?? "");
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [directionPrompt, setDirectionPrompt] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const deferredMessageSearch = useDeferredValue(messageSearch);

  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const [forceMode, setForceMode] = useState(false);

  const [draftForm, setDraftForm] = useState<DraftFormState | null>(null);
  const [noEntryReason, setNoEntryReason] = useState<string | null>(null);

  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  const contextSessionAppliedRef = useRef(false);

  useEffect(() => {
    setSelectedCharacterId(context?.characterId ?? "");
    setSelectedSessionId(context?.sessionId ?? "");
    setSelectedMessageIds(new Set());
    setDraftForm(null);
    setNoEntryReason(null);
    contextSessionAppliedRef.current = false;
  }, [context?.characterId, context?.lorebookId, context?.sessionId]);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setIsBootLoading(true);
    void (async () => {
      try {
        const [allLorebooks, allCharacters] = await Promise.all([
          listLorebooks(),
          listCharacters(),
        ]);
        if (cancelled) return;
        setLorebook(allLorebooks.find((item) => item.id === context.lorebookId) ?? null);
        setCharacters(allCharacters);
      } catch (error) {
        console.error("Failed to load lorebook generator context:", error);
        if (!cancelled) toast.error("Failed to load lorebook generator");
      } finally {
        if (!cancelled) setIsBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context]);

  useEffect(() => {
    if (!selectedCharacterId) {
      setSessions([]);
      setSelectedSessionId("");
      setMessages([]);
      setSelectedMessageIds(new Set());
      return;
    }
    let cancelled = false;
    setIsSessionLoading(true);
    setMessages([]);
    setSelectedMessageIds(new Set());
    void (async () => {
      try {
        const previews = await listSessionPreviews(selectedCharacterId);
        if (cancelled) return;
        setSessions(previews);
        const sessionFromContext =
          context?.kind === "character" && context.characterId === selectedCharacterId
            ? context.sessionId
            : null;
        if (!contextSessionAppliedRef.current && sessionFromContext) {
          contextSessionAppliedRef.current = true;
          if (previews.some((preview) => preview.id === sessionFromContext)) {
            setSelectedSessionId(sessionFromContext);
          }
        } else if (!selectedSessionId && previews.length > 0) {
          setSelectedSessionId(previews[0].id);
        }
      } catch (error) {
        console.error("Failed to load session previews:", error);
        if (!cancelled) {
          toast.error("Failed to load sessions");
          setSessions([]);
        }
      } finally {
        if (!cancelled) setIsSessionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, selectedCharacterId]);

  useEffect(() => {
    setMessages([]);
    setSelectedMessageIds(new Set());
    setHasMoreMessages(false);
    if (!selectedSessionId) return;
    void loadMessagesPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  const loadMessagesPage = async (reset: boolean) => {
    if (!selectedSessionId) return;
    const before =
      !reset && messages.length > 0
        ? { createdAt: messages[0].createdAt, id: messages[0].id }
        : undefined;
    try {
      if (reset) setIsMessagesLoading(true);
      else setIsLoadingMoreMessages(true);
      const nextPage = await listMessages(selectedSessionId, {
        limit: MESSAGE_PAGE_LIMIT,
        before,
      });
      setHasMoreMessages(nextPage.length === MESSAGE_PAGE_LIMIT);
      setMessages((prev) => {
        if (reset) return nextPage;
        const merged = [...nextPage, ...prev];
        const seen = new Set<string>();
        return merged.filter((message) => {
          if (seen.has(message.id)) return false;
          seen.add(message.id);
          return true;
        });
      });
    } catch (error) {
      console.error("Failed to load session messages:", error);
      toast.error("Failed to load messages");
    } finally {
      setIsMessagesLoading(false);
      setIsLoadingMoreMessages(false);
    }
  };

  const filteredMessages = useMemo(() => {
    const query = deferredMessageSearch.trim().toLowerCase();
    return messages.filter((message) => {
      if (roleFilter !== "all" && message.role !== roleFilter) return false;
      if (!query) return true;
      const haystack = [message.role, message.content].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredMessageSearch, messages, roleFilter]);

  const selectedCount = selectedMessageIds.size;
  const selectedSession = sessions.find((item) => item.id === selectedSessionId) ?? null;
  const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) ?? null;
  const characterPickerLocked = context?.kind === "character";

  const selectedTokenEstimate = useMemo(() => {
    if (selectedCount === 0) return 0;
    let total = 0;
    for (const message of messages) {
      if (selectedMessageIds.has(message.id)) total += estimateTokens(message.content);
    }
    return total;
  }, [messages, selectedMessageIds, selectedCount]);

  const toggleMessageSelection = (messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const selectAllFilteredMessages = () => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      for (const message of filteredMessages) next.add(message.id);
      return next;
    });
  };

  const selectLastN = (n: number) => {
    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    const tail = sorted.slice(-n);
    setSelectedMessageIds(new Set(tail.map((m) => m.id)));
  };

  const clearSelection = () => setSelectedMessageIds(new Set());

  const handleGenerate = async () => {
    if (!context || !selectedSessionId || selectedMessageIds.size === 0) return;
    try {
      setIsGenerating(true);
      setNoEntryReason(null);
      const effectiveDirection = forceMode
        ? [
            "[FORCE MODE] Always call write_lorebook_entry. Do not return no_entry. Ignore duplicate-avoidance and weak-canon rules; produce the best possible durable lorebook entry from the selected messages even if the facts are already covered or seem transient.",
            directionPrompt.trim(),
          ]
            .filter(Boolean)
            .join("\n\n")
        : directionPrompt;
      const result = await generateLorebookEntryDraft({
        lorebookId: context.lorebookId,
        sessionId: selectedSessionId,
        messageIds: Array.from(selectedMessageIds),
        directionPrompt: effectiveDirection,
        force: forceMode,
      });
      if (result.kind === "none") {
        setDraftForm(null);
        setNoEntryReason(result.reason?.trim() || "No durable lorebook entry was found.");
        return;
      }
      if (!result.draft) throw new Error("Generator returned no draft");
      setDraftForm(buildDraftFormState(result.draft));
      setNoEntryReason(null);
    } catch (error) {
      console.error("Failed to generate lorebook entry draft:", error);
      toast.error("Generation failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!context || !draftForm) return;
    const title = draftForm.title.trim();
    const content = draftForm.content.trim();
    const keywords = parseKeywordsInput(draftForm.keywordsText);
    if (!title || !content) {
      toast.error("Title and content are required");
      return;
    }
    if (!draftForm.alwaysActive && keywords.length === 0) {
      toast.error("Add at least one keyword or enable Always active");
      return;
    }
    try {
      setIsSaving(true);
      const created = await createBlankLorebookEntry(context.lorebookId);
      const nextEntry: LorebookEntry = {
        ...created,
        title,
        content,
        keywords,
        alwaysActive: draftForm.alwaysActive,
        enabled: true,
      };
      await saveLorebookEntry(nextEntry);
      toast.success("Lorebook entry saved");
      backOrReplace(context.backPath);
    } catch (error) {
      console.error("Failed to save generated lorebook entry:", error);
      toast.error("Save failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    if (context) backOrReplace(context.backPath);
    else backOrReplace(Routes.settings);
  };

  const canGenerate = Boolean(selectedSessionId) && selectedCount > 0 && !isGenerating;

  if (!context) {
    return (
      <div className="flex h-full flex-col bg-surface pt-[calc(72px+env(safe-area-inset-top))]">
        <TopNav
          currentPath={location.pathname + location.search}
          titleOverride="Generate Lorebook Entry"
          onBackOverride={handleBack}
        />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg/60">
          Missing lorebook context for the generator page.
        </div>
      </div>
    );
  }

  const pageTitle = lorebook ? `${lorebook.name} · Generate` : "Generate Lorebook Entry";

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-surface pt-[calc(72px+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
      <TopNav
        currentPath={location.pathname + location.search}
        titleOverride={pageTitle}
        onBackOverride={handleBack}
      />

      <div className="flex items-center gap-2 border-b border-fg/10 px-3 py-2">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => !characterPickerLocked && setCharacterPickerOpen((v) => !v)}
            disabled={isBootLoading || characterPickerLocked}
            title={characterPickerLocked ? "Character is locked to this lorebook's owner" : undefined}
            className={`flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-fg/80 transition ${
              characterPickerLocked
                ? "cursor-default opacity-70"
                : "hover:border-fg/20 hover:bg-fg/10 disabled:opacity-60"
            }`}
          >
            <Hash className="h-3.5 w-3.5 text-fg/45" />
            <span className="max-w-[120px] truncate">
              {selectedCharacter?.name ?? "Character"}
            </span>
            {!characterPickerLocked && (
              <ChevronDown
                className={`h-3.5 w-3.5 text-fg/45 transition ${characterPickerOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>
          <AnimatePresence>
            {characterPickerOpen && !characterPickerLocked && (
              <Dropdown onClose={() => setCharacterPickerOpen(false)} title="Characters">
                  {characters.length === 0 ? (
                    <EmptyDropdown>No characters</EmptyDropdown>
                  ) : (
                    <div className="scrollbar-thin max-h-72 overflow-y-auto py-1">
                      {characters.map((c) => {
                        const isSelected = selectedCharacterId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCharacterId(c.id);
                              setSelectedSessionId("");
                              setCharacterPickerOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
                              isSelected ? "bg-accent/10" : "hover:bg-fg/5"
                            }`}
                          >
                            {isSelected ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                            ) : (
                              <div className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <div className="truncate text-sm text-fg">{c.name}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        <div className="relative shrink-0 min-w-[160px] max-w-[280px]">
          <button
            type="button"
            onClick={() => setSessionPickerOpen((v) => !v)}
            disabled={!selectedCharacterId || isSessionLoading}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] px-2.5 py-1.5 text-[12px] text-left transition hover:border-fg/20 hover:bg-fg/10 disabled:opacity-60"
          >
            <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-fg/45" />
            <div className="min-w-0 flex-1">
              {isSessionLoading ? (
                <div className="h-3 w-24 animate-pulse rounded bg-fg/10" />
              ) : selectedSession ? (
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="truncate font-semibold text-fg">
                    {selectedSession.title || "Untitled"}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-fg/40">
                    {selectedSession.messageCount}m
                  </span>
                </div>
              ) : (
                <span className="text-fg/55">
                  {selectedCharacterId ? "Choose session" : "Pick character"}
                </span>
              )}
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-fg/45 transition ${sessionPickerOpen ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence>
            {sessionPickerOpen && (
              <Dropdown onClose={() => setSessionPickerOpen(false)} title="Sessions">
                {sessions.length === 0 ? (
                  <EmptyDropdown>No sessions</EmptyDropdown>
                ) : (
                  <div className="scrollbar-thin max-h-72 overflow-y-auto py-1">
                    {sessions.map((s) => {
                      const isSelected = selectedSession?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedSessionId(s.id);
                            setSessionPickerOpen(false);
                          }}
                          className={`flex w-full items-start gap-2 px-3 py-2 text-left transition ${
                            isSelected ? "bg-accent/10" : "hover:bg-fg/5"
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {isSelected ? (
                              <Check className="h-3.5 w-3.5 text-accent" />
                            ) : (
                              <div className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-fg">
                              {s.title || "Untitled"}
                            </div>
                            <div className="mt-0.5 text-[11px] font-mono text-fg/35">
                              {formatRelative(s.updatedAt)} · {s.messageCount}m
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] px-2 py-1.5 focus-within:border-fg/20">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg/40" />
          <input
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
            placeholder="Search messages"
            disabled={!selectedSession}
            className="w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-fg/35"
          />
          {messageSearch && (
            <button
              type="button"
              onClick={() => setMessageSearch("")}
              className="text-fg/40 transition hover:text-fg/70"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {selectedCount > 0 && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1">
            <span className="text-[11px] font-semibold text-accent">{selectedCount}</span>
            <span className="font-mono text-[10px] text-accent/65">~{selectedTokenEstimate}t</span>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded p-0.5 text-accent/60 transition hover:bg-accent/15 hover:text-accent"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-fg/10 px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md bg-fg/[0.04] p-0.5">
          <FilterPill active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
            All
          </FilterPill>
          <FilterPill active={roleFilter === "user"} onClick={() => setRoleFilter("user")}>
            User
          </FilterPill>
          <FilterPill active={roleFilter === "assistant"} onClick={() => setRoleFilter("assistant")}>
            AI
          </FilterPill>
        </div>

        <div className="hidden h-4 w-px bg-fg/10 sm:block" />

        <div className="flex items-center gap-0.5">
          <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">
            Last
          </span>
          {QUICK_RANGES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => selectLastN(n)}
              disabled={messages.length === 0}
              className="rounded px-1.5 py-1 text-[11px] font-medium text-fg/60 transition hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              title={`Select last ${n} messages`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={selectAllFilteredMessages}
            disabled={filteredMessages.length === 0}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-fg/60 transition hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Select all
          </button>
          <span className="font-mono text-[10px] text-fg/35">
            {filteredMessages.length}/{messages.length}
          </span>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
        {!selectedSession ? (
          <EmptyHint icon={<History className="h-4 w-4 text-fg/40" />}>
            Select a session to load messages.
          </EmptyHint>
        ) : isMessagesLoading ? (
          <MessagesSkeleton />
        ) : filteredMessages.length === 0 ? (
          <EmptyHint icon={<Search className="h-4 w-4 text-fg/40" />}>
            {messages.length === 0 ? "Session has no messages." : "No messages match the filter."}
          </EmptyHint>
        ) : (
          <div className="px-3 py-2">
            {hasMoreMessages && (
              <button
                type="button"
                onClick={() => void loadMessagesPage(false)}
                disabled={isLoadingMoreMessages}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-fg/15 px-3 py-1.5 text-[11px] font-medium text-fg/55 transition hover:border-fg/25 hover:text-fg disabled:opacity-60"
              >
                {isLoadingMoreMessages ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Load older messages
              </button>
            )}

            <div className="divide-y divide-fg/5">
              {filteredMessages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  selected={selectedMessageIds.has(msg.id)}
                  onToggle={() => toggleMessageSelection(msg.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {noEntryReason && (
        <div className="border-t border-warning/20 bg-warning/10 px-4 py-2 text-[12px] text-warning">
          <span className="font-semibold">No entry generated.</span> {noEntryReason}
        </div>
      )}

      <AnimatePresence>
        {directionOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-fg/10 bg-surface-el/30"
          >
            <div className="px-3 py-2">
              <textarea
                value={directionPrompt}
                onChange={(e) => setDirectionPrompt(e.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-none rounded-lg border border-fg/10 bg-surface-el/40 px-2.5 py-2 text-[12.5px] leading-relaxed text-fg outline-none transition focus:border-fg/25"
                placeholder='Optional direction — e.g. "Focus on world lore, ignore banter."'
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2 border-t border-fg/10 bg-surface/95 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => setDirectionOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition ${
            directionPrompt.trim()
              ? "border-info/30 bg-info/10 text-info"
              : directionOpen
                ? "border-fg/20 bg-fg/10 text-fg"
                : "border-fg/10 bg-fg/5 text-fg/65 hover:bg-fg/10"
          }`}
          title="Optional generation direction"
        >
          <Compass className="h-3.5 w-3.5" />
          <span>Direction</span>
          {directionPrompt.trim() && <span className="h-1.5 w-1.5 rounded-full bg-info" />}
        </button>

        <div className="min-w-0 flex-1 truncate text-[11px] text-fg/50">
          {selectedCount > 0
            ? `${selectedCount} message${selectedCount === 1 ? "" : "s"} · ~${selectedTokenEstimate} tokens`
            : "Select messages to generate"}
        </div>

        <button
          type="button"
          onClick={() => setForceMode((v) => !v)}
          title={
            forceMode
              ? "Force mode on — next Generate bypasses duplicate/weak-canon rules"
              : "Toggle force mode"
          }
          aria-label="Toggle force mode"
          aria-pressed={forceMode}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${
            forceMode
              ? "bg-danger/15 text-danger"
              : "text-fg/35 hover:bg-fg/5 hover:text-fg/70"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            forceMode
              ? "border-danger/40 bg-danger/15 text-danger hover:bg-danger/25"
              : "border-accent/30 bg-accent/15 text-accent hover:bg-accent/25"
          }`}
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : forceMode ? (
            <Zap className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {forceMode ? "Force Generate" : "Generate"}
        </button>
      </div>

      <AnimatePresence>
        {draftForm && (
          <ReviewOverlay
            form={draftForm}
            onChange={setDraftForm}
            onSave={handleSaveDraft}
            onClose={() => setDraftForm(null)}
            onRegenerate={handleGenerate}
            isSaving={isSaving}
            isGenerating={isGenerating}
            lorebookName={lorebook?.name ?? "lorebook"}
            directionPrompt={directionPrompt}
            onDirectionChange={setDirectionPrompt}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-[11px] font-medium transition ${
        active ? "bg-fg/15 text-fg" : "text-fg/55 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Dropdown({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-10"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className="absolute left-0 right-0 top-full z-20 mt-1 min-w-[220px] origin-top overflow-hidden rounded-xl border border-fg/15 bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-fg/10 px-3 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/55">
            {title}
          </div>
          <button type="button" onClick={onClose} className="text-fg/40 transition hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        </div>
        {children}
      </motion.div>
    </>
  );
}

function EmptyDropdown({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-sm text-fg/50">{children}</div>;
}

function EmptyHint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-fg/10 bg-fg/5">
        {icon}
      </div>
      <div className="text-sm text-fg/55">{children}</div>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="divide-y divide-fg/5 px-3 py-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-1.5 py-3">
          <div className="h-3 w-20 animate-pulse rounded bg-fg/10" />
          <div className="h-3 w-full animate-pulse rounded bg-fg/10" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-fg/10" />
        </div>
      ))}
    </div>
  );
}

function MessageRow({
  message,
  selected,
  onToggle,
}: {
  message: StoredMessage;
  selected: boolean;
  onToggle: () => void;
}) {
  const role = roleMeta(message.role);
  const content = message.content.trim();
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (expanded) {
      setIsOverflowing(true);
      return;
    }
    setIsOverflowing(el.scrollHeight - el.clientHeight > 1);
  }, [content, expanded]);

  return (
    <div
      className={`flex items-start gap-2.5 py-2.5 pl-1 pr-2 transition ${
        selected ? "bg-accent/5" : "hover:bg-fg/[0.03]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={selected ? "Deselect message" : "Select message"}
        className={`mt-0.5 shrink-0 rounded p-0.5 transition ${
          selected ? "text-accent" : "text-fg/30 hover:text-fg/60"
        }`}
      >
        {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <div className="mb-0.5 flex items-center gap-2">
          {role.icon}
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${role.labelClass}`}>
            {role.label}
          </span>
          <span className="ml-auto font-mono text-[10px] text-fg/30">
            {formatRelative(message.createdAt)}
          </span>
        </div>
        <div
          ref={textRef}
          className={`whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-fg/80 ${
            expanded ? "" : "line-clamp-3"
          }`}
        >
          {content || <span className="italic text-fg/35">Empty message</span>}
        </div>
      </button>
      {isOverflowing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-0.5 shrink-0 rounded p-1 text-fg/40 transition hover:bg-fg/5 hover:text-fg"
          aria-label={expanded ? "Collapse message" : "Expand message"}
          title={expanded ? "Show less" : "Show full message"}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </div>
  );
}

function ReviewOverlay({
  form,
  onChange,
  onSave,
  onClose,
  onRegenerate,
  isSaving,
  isGenerating,
  lorebookName,
  directionPrompt,
  onDirectionChange,
}: {
  form: DraftFormState;
  onChange: (next: DraftFormState | ((prev: DraftFormState | null) => DraftFormState | null)) => void;
  onSave: () => void;
  onClose: () => void;
  onRegenerate: () => void;
  isSaving: boolean;
  isGenerating: boolean;
  lorebookName: string;
  directionPrompt: string;
  onDirectionChange: (value: string) => void;
}) {
  const setField = <K extends keyof DraftFormState>(key: K, value: DraftFormState[K]) => {
    onChange((prev) => (prev ? { ...prev, [key]: value } : prev));
  };
  const keywords = form.keywordsText
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const [directionEditorOpen, setDirectionEditorOpen] = useState(false);

  return (
    <>
      <motion.div
        className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 260 }}
        className="absolute inset-x-0 bottom-0 top-[max(48px,calc(72px+env(safe-area-inset-top)))] z-40 flex flex-col overflow-hidden rounded-t-2xl border-t border-fg/15 bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <Sparkles className="h-4 w-4 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-fg">Review draft</div>
            <div className="text-[11px] text-fg/50">
              Saving into <span className="font-medium text-fg/70">{lorebookName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-fg/45 transition hover:bg-fg/5 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-3">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            <FieldRow label="Title">
              <input
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                className="w-full rounded-md border border-fg/10 bg-surface-el/30 px-2.5 py-2 text-[13px] text-fg outline-none transition focus:border-fg/25"
                placeholder="Entry title"
              />
            </FieldRow>

            <div className="flex items-center justify-between rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5">
              <div>
                <div className="text-[12.5px] font-semibold text-fg">Always active</div>
                <div className="mt-0.5 text-[11px] text-fg/50">
                  Skip keyword triggers; always inject.
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.alwaysActive}
                  onChange={(e) => setField("alwaysActive", e.target.checked)}
                />
                <span
                  className={`relative inline-flex h-5 w-9 rounded-full transition ${
                    form.alwaysActive ? "bg-accent" : "bg-fg/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                      form.alwaysActive ? "left-4" : "left-0.5"
                    }`}
                  />
                </span>
              </label>
            </div>

            {!form.alwaysActive && (
              <FieldRow
                label="Keywords"
                hint={
                  keywords.length > 0
                    ? `${keywords.length} keyword${keywords.length === 1 ? "" : "s"}`
                    : "Comma-separated triggers"
                }
              >
                <input
                  value={form.keywordsText}
                  onChange={(e) => setField("keywordsText", e.target.value)}
                  className="w-full rounded-md border border-fg/10 bg-surface-el/30 px-2.5 py-2 text-[13px] text-fg outline-none transition focus:border-fg/25"
                  placeholder="comma, separated, keywords"
                />
                {keywords.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {keywords.map((k) => (
                      <span
                        key={k}
                        className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-mono text-fg/75"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </FieldRow>
            )}

            <FieldRow label="Content" hint={`${form.content.length} chars`}>
              <textarea
                value={form.content}
                onChange={(e) => setField("content", e.target.value)}
                rows={14}
                className="w-full resize-none rounded-md border border-fg/10 bg-surface-el/30 px-2.5 py-2 text-[13px] leading-relaxed text-fg outline-none transition focus:border-fg/25"
                placeholder="Lorebook entry content"
              />
            </FieldRow>
          </div>
        </div>

        <AnimatePresence>
          {directionEditorOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden border-t border-fg/10 bg-surface-el/30"
            >
              <div className="px-3 py-2">
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/50">
                    Direction
                  </label>
                  <span className="text-[10px] font-mono text-fg/35">
                    Edits apply on next Regenerate
                  </span>
                </div>
                <textarea
                  value={directionPrompt}
                  onChange={(e) => onDirectionChange(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-md border border-fg/10 bg-surface-el/40 px-2.5 py-2 text-[12.5px] leading-relaxed text-fg outline-none transition focus:border-fg/25"
                  placeholder='e.g. "Focus on world lore, ignore banter."'
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 border-t border-fg/10 bg-surface/95 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setDirectionEditorOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition ${
              directionPrompt.trim()
                ? "border-info/30 bg-info/10 text-info"
                : directionEditorOpen
                  ? "border-fg/20 bg-fg/10 text-fg"
                  : "border-fg/10 bg-fg/5 text-fg/65 hover:bg-fg/10"
            }`}
            title="Edit direction before regenerating"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Direction</span>
            {directionPrompt.trim() && <span className="h-1.5 w-1.5 rounded-full bg-info" />}
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-2 text-[12px] font-medium text-fg/70 transition hover:bg-fg/10 disabled:opacity-60"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Regenerate
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-2 text-[12px] font-medium text-fg/70 transition hover:bg-fg/10"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/15 px-3.5 py-2 text-[12px] font-semibold text-accent transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save Entry
          </button>
        </div>
      </motion.div>
    </>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between px-0.5">
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/50">
          {label}
        </label>
        {hint && <span className="text-[10px] font-mono text-fg/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
