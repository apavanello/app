import {
  ArrowLeft,
  User,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Image as ImageIcon,
  Brain,
  BarChart3,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import React, { useState } from "react";

import { processBackgroundImage } from "../../../core/utils/image";
import { BottomMenu } from "../../components";
import { typography, radius, spacing, interactive, cn } from "../../design-tokens";
import { useNavigationManager, Routes } from "../../navigation";
import { useAvatar } from "../../hooks/useAvatar";
import { AvatarImage } from "../../components/AvatarImage";
import { useGroupSettingsController } from "./hooks/useGroupSettingsController";
import { CharacterAvatar, PersonaSelector, QuickChip, SectionHeader } from "./components/settings";

export function GroupSettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { backOrReplace } = useNavigationManager();

  const {
    group,
    personas,
    currentPersona,
    groupCharacters,
    availableCharacters,
    currentPersonaDisplay,
    mutedCharacterIds,
    ui,
    setEditingName,
    setNameDraft,
    setShowPersonaSelector,
    setShowAddCharacter,
    setShowRemoveConfirm,
    handleSaveName,
    handleChangePersona,
    handleAddCharacter,
    handleRemoveCharacter,
    handleSetCharacterMuted,
    handleChangeSpeakerSelectionMethod,
    handleChangeMemoryType,
    handleUpdateBackgroundImage,
  } = useGroupSettingsController(groupId);

  const [backgroundImagePath, setBackgroundImagePath] = useState("");
  const [savingBackground, setSavingBackground] = useState(false);

  const personaAvatarUrl = useAvatar(
    "persona",
    currentPersona?.id ?? "",
    currentPersona?.avatarPath,
    "round",
  );

  React.useEffect(() => {
    if (group?.backgroundImagePath !== undefined) {
      setBackgroundImagePath(group.backgroundImagePath || "");
    }
  }, [group?.backgroundImagePath]);

  const handleBackgroundImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const input = event.target;
    setSavingBackground(true);
    void processBackgroundImage(file)
      .then(async (dataUrl: string) => {
        setBackgroundImagePath(dataUrl);
        await handleUpdateBackgroundImage(dataUrl);
      })
      .catch((error: unknown) => {
        console.warn("Failed to process background image", error);
      })
      .finally(() => {
        input.value = "";
        setSavingBackground(false);
      });
  };

  const handleRemoveBackground = async () => {
    setSavingBackground(true);
    try {
      setBackgroundImagePath("");
      await handleUpdateBackgroundImage(null);
    } catch (error) {
      console.error("Failed to remove background:", error);
    } finally {
      setSavingBackground(false);
    }
  };

  const {
    loading,
    error,
    editingName,
    nameDraft,
    showPersonaSelector,
    showAddCharacter,
    showRemoveConfirm,
    saving,
  } = ui;

  const handleBack = () => backOrReplace(Routes.groupChats);

  // Loading skeleton
  if (loading && !group) {
    return (
      <div className="flex h-full flex-col text-fg">
        <header className="shrink-0 border-b border-fg/10 px-4 pb-3 pt-10">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-fg/10" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-1/3 animate-pulse rounded bg-fg/10" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-fg/10" />
            </div>
          </div>
        </header>
        <main className="flex-1 p-4">
          <div className="space-y-4">
            <div className="h-20 animate-pulse rounded-xl bg-fg/5" />
            <div className="h-20 animate-pulse rounded-xl bg-fg/5" />
            <div className="h-40 animate-pulse rounded-xl bg-fg/5" />
          </div>
        </main>
      </div>
    );
  }

  // Error state
  if (error || !group) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-fg p-8">
        <p className="text-lg font-medium text-danger">{error || "Group not found"}</p>
        <button
          onClick={() => navigate(Routes.groupChats)}
          className="mt-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-2 text-sm"
        >
          Back to Groups
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col text-fg overflow-hidden bg-surface">
      {/* Header */}
      <header className="relative z-20 shrink-0 border-b border-fg/10 px-4 pb-3 pt-10 bg-surface">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="flex shrink-0 px-[0.6em] py-[0.3em] items-center justify-center -ml-2 text-fg transition hover:text-fg/80"
            aria-label="Back"
          >
            <ArrowLeft size={14} strokeWidth={2.5} />
          </button>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-xl font-bold text-fg/90">Edit Group</p>
            <p className="mt-0.5 truncate text-xs text-fg/50">
              Update the default setup for future sessions
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="relative z-10 flex-1 overflow-y-auto px-3 pt-4 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={spacing.section}
        >
          {/* Header Card — Name + Background */}
          <section className={spacing.item}>
            <div
              className={cn(
                radius.lg,
                "border border-fg/10 bg-surface-el/85 backdrop-blur-sm overflow-hidden",
              )}
            >
              {/* Background Preview */}
              {backgroundImagePath ? (
                <div className="relative h-24">
                  <img
                    src={backgroundImagePath}
                    alt="Background"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-[#0c0d13] to-transparent" />
                  <button
                    onClick={() => void handleRemoveBackground()}
                    disabled={savingBackground}
                    className={cn(
                      "absolute top-2 right-2 flex h-6 w-6 items-center justify-center",
                      radius.full,
                      "bg-surface-el/60 text-fg/70",
                      interactive.transition.fast,
                      "hover:bg-danger/80 hover:text-fg",
                      "disabled:opacity-50",
                    )}
                    aria-label="Remove background"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}

              {/* Group Info */}
              <div className="p-4">
                {editingName ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className={cn(
                        "flex-1 bg-transparent py-1",
                        typography.body.size,
                        typography.body.weight,
                        "text-fg placeholder-fg/30",
                        "border-b border-accent/50 focus:border-accent",
                        "focus:outline-none transition-colors",
                      )}
                      placeholder="Enter group name"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={saving || !nameDraft.trim()}
                      className={cn(
                        "flex items-center justify-center",
                        radius.full,
                        "bg-accent/20 text-accent/80",
                        interactive.transition.default,
                        "hover:bg-accent/30 disabled:opacity-50",
                      )}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setNameDraft(group.name);
                        setEditingName(false);
                      }}
                      className={cn(
                        "flex items-center justify-center",
                        radius.full,
                        "bg-fg/10 text-fg/60",
                        interactive.transition.default,
                        "hover:bg-fg/20",
                      )}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingName(true)}
                    className="flex w-full items-center justify-between text-left group"
                  >
                    <div className="min-w-0">
                      <p
                        className={cn(typography.h3.size, typography.h3.weight, "text-fg truncate")}
                      >
                        {group.name}
                      </p>
                      <p className={cn(typography.caption.size, "text-fg/45 mt-0.5")}>
                        {groupCharacters.length}{" "}
                        {groupCharacters.length === 1 ? "participant" : "participants"}
                      </p>
                    </div>
                    <Edit2 className="h-4 w-4 shrink-0 text-fg/30 transition-colors group-hover:text-fg/60" />
                  </button>
                )}

                {/* Background action */}
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 mt-3 py-2 px-3",
                    radius.md,
                    "border border-dashed border-fg/15 text-fg/50",
                    interactive.transition.default,
                    "hover:border-fg/25 hover:bg-fg/5 hover:text-fg/70",
                    savingBackground && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <ImageIcon className="h-4 w-4" />
                  <span className={cn(typography.caption.size)}>
                    {savingBackground
                      ? "Uploading..."
                      : backgroundImagePath
                        ? "Change background"
                        : "Add background image"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundImageUpload}
                    disabled={savingBackground}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Persona Section */}
          <section className={spacing.item}>
            <SectionHeader title="Persona" subtitle="Default persona for new sessions" />
            <QuickChip
              icon={
                personaAvatarUrl ? (
                  <div className="h-full w-full overflow-hidden rounded-full">
                    <AvatarImage
                      src={personaAvatarUrl}
                      alt={currentPersona?.title ?? "Persona"}
                      crop={currentPersona?.avatarCrop}
                      applyCrop
                    />
                  </div>
                ) : (
                  <User className="h-4 w-4" />
                )
              }
              label="Persona"
              value={currentPersonaDisplay}
              onClick={() => setShowPersonaSelector(true)}
            />
          </section>

          {/* Speaker Selection Method */}
          <section className={spacing.item}>
            <SectionHeader title="Speaker Selection" subtitle="Default method for new sessions" />
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  {
                    value: "llm" as const,
                    label: "LLM",
                    desc: "AI picks",
                    icon: Brain,
                  },
                  {
                    value: "heuristic" as const,
                    label: "Heuristic",
                    desc: "Score-based",
                    icon: BarChart3,
                  },
                  {
                    value: "round_robin" as const,
                    label: "Round Robin",
                    desc: "Take turns",
                    icon: RefreshCw,
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleChangeSpeakerSelectionMethod(option.value)}
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 p-3",
                    radius.lg,
                    "border text-center",
                    interactive.transition.fast,
                    group.speakerSelectionMethod === option.value
                      ? "border-accent/40 bg-accent/10"
                      : "border-fg/10 bg-surface-el/85 hover:border-fg/20",
                  )}
                >
                  <option.icon
                    className={cn(
                      "h-5 w-5",
                      group.speakerSelectionMethod === option.value
                        ? "text-accent/80"
                        : "text-fg/50",
                    )}
                  />
                  <div
                    className={cn(
                      "text-xs font-semibold",
                      group.speakerSelectionMethod === option.value
                        ? "text-accent"
                        : "text-fg/80",
                    )}
                  >
                    {option.label}
                  </div>
                  <div className="text-[10px] text-fg/40">{option.desc}</div>
                </button>
              ))}
            </div>
            <p className={cn(typography.caption.size, "mt-2 text-fg/40")}>
              {group.speakerSelectionMethod === "llm"
                ? "Uses your default model to choose who speaks (costs tokens)"
                : group.speakerSelectionMethod === "heuristic"
                  ? "Uses participation balance and context clues (free)"
                  : "Characters take turns in order (free)"}
            </p>
          </section>

          {/* Memory Mode */}
          <section className={spacing.item}>
            <SectionHeader title="Memory Mode" subtitle="Default memory mode for new sessions" />
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    value: "manual" as const,
                    label: "Manual",
                    desc: "Manage notes yourself",
                    icon: Brain,
                  },
                  {
                    value: "dynamic" as const,
                    label: "Dynamic",
                    desc: "Automatic recall",
                    icon: Brain,
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleChangeMemoryType(option.value)}
                  disabled={saving}
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 p-3",
                    radius.lg,
                    "border text-center",
                    interactive.transition.fast,
                    group.memoryType === option.value
                      ? "border-accent/40 bg-accent/10"
                      : "border-fg/10 bg-surface-el/85 hover:border-fg/20",
                    saving && "opacity-50",
                  )}
                >
                  <option.icon
                    className={cn(
                      "h-5 w-5",
                      group.memoryType === option.value
                        ? "text-accent/80"
                        : "text-fg/50",
                    )}
                  />
                  <div
                    className={cn(
                      "text-xs font-semibold",
                      group.memoryType === option.value
                        ? "text-accent"
                        : "text-fg/80",
                    )}
                  >
                    {option.label}
                  </div>
                  <div className="text-[10px] text-fg/40">{option.desc}</div>
                </button>
              ))}
            </div>
            <p className={cn(typography.caption.size, "mt-2 text-fg/40")}>
              {group.memoryType === "dynamic"
                ? "AI automatically creates and retrieves memories from conversations"
                : "You add and manage memory notes yourself"}
            </p>
          </section>

          {/* Characters Section */}
          <section className={spacing.item}>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader
                title="Characters"
                subtitle={`${groupCharacters.length} participants · ${groupCharacters.length - (group.mutedCharacterIds?.length ?? 0)} active`}
              />
              <button
                onClick={() => setShowAddCharacter(true)}
                disabled={availableCharacters.length === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5",
                  "rounded-full text-xs font-medium",
                  "border transition",
                  availableCharacters.length === 0
                    ? "border-fg/5 bg-fg/5 text-fg/30 cursor-not-allowed"
                    : "border-accent/30 bg-accent/10 text-accent/80 hover:bg-accent/20",
                )}
              >
                <Plus size={14} />
                Add
              </button>
            </div>

            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {groupCharacters.map((character) => {
                  const isMuted = mutedCharacterIds.has(character.id);

                  return (
                    <motion.div
                      key={character.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={cn(
                        "flex items-center gap-3 p-3",
                        radius.lg,
                        "border border-fg/10 bg-surface-el/85",
                      )}
                    >
                      <CharacterAvatar character={character} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg truncate">
                          {character.name}
                          {isMuted && (
                            <span className="ml-2 text-[10px] text-fg/40">(muted)</span>
                          )}
                        </p>
                        <p className="text-xs text-fg/50 mt-0.5">
                          {isMuted ? "Muted by default" : "Active by default"}
                        </p>
                      </div>
                      <button
                        onClick={() => handleSetCharacterMuted(character.id, !isMuted)}
                        className={cn(
                          "flex items-center justify-center rounded-lg p-1.5 transition",
                          isMuted
                            ? "text-amber-300 hover:bg-amber-500/10"
                            : "text-fg/40 hover:text-fg hover:bg-fg/10",
                        )}
                        title={isMuted ? "Unmute character" : "Mute character"}
                      >
                        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                      </button>
                      <button
                        onClick={() => setShowRemoveConfirm(character.id)}
                        disabled={groupCharacters.length <= 2}
                        className={cn(
                          "flex items-center justify-center rounded-lg transition",
                          groupCharacters.length <= 2
                            ? "text-fg/20 cursor-not-allowed"
                            : "text-fg/40 hover:text-danger hover:bg-danger/10",
                        )}
                        title={
                          groupCharacters.length <= 2
                            ? "Minimum 2 characters required"
                            : "Remove character"
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {groupCharacters.length <= 2 && (
              <p className="mt-2 text-xs text-fg/40 text-center">
                A group requires at least 2 characters
              </p>
            )}
            <p className="mt-2 text-xs text-fg/40 text-center">
              Muted characters are skipped by auto speaker selection, but can still respond via
              explicit `@mention`.
            </p>
          </section>

          {/* Error banner */}
          {error ? (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}
        </motion.div>
      </main>

      {/* Persona Selector Modal */}
      <PersonaSelector
        isOpen={showPersonaSelector}
        onClose={() => setShowPersonaSelector(false)}
        personas={personas}
        selectedPersonaId={group.personaId}
        onSelect={(personaId) => void handleChangePersona(personaId)}
      />

      {/* Add Character Modal */}
      <BottomMenu
        isOpen={showAddCharacter}
        onClose={() => setShowAddCharacter(false)}
        title="Add Character"
      >
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {availableCharacters.length === 0 ? (
            <div className="text-center py-8 text-fg/50 text-sm">
              All characters are already in this group.
            </div>
          ) : (
            availableCharacters.map((character) => (
              <button
                key={character.id}
                onClick={() => void handleAddCharacter(character.id)}
                disabled={saving}
                className={cn(
                  "flex w-full items-center gap-3 p-3 text-left",
                  radius.lg,
                  "border border-fg/10 bg-surface-el/85",
                  interactive.transition.default,
                  "hover:border-fg/20 hover:bg-fg/10",
                  "disabled:opacity-50",
                )}
              >
                <CharacterAvatar character={character} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{character.name}</p>
                  {(character.description || character.definition) && (
                    <p className="text-xs text-fg/50 truncate mt-0.5">
                      {character.description || character.definition}
                    </p>
                  )}
                </div>
                <Plus className="h-4 w-4 text-accent" />
              </button>
            ))
          )}
        </div>
      </BottomMenu>

      {/* Remove Character Confirmation */}
      <BottomMenu
        isOpen={showRemoveConfirm !== null}
        onClose={() => setShowRemoveConfirm(null)}
        title="Remove Character?"
      >
        {showRemoveConfirm && (
          <div className="space-y-4">
            <p className="text-sm text-fg/70">
              Are you sure you want to remove{" "}
              <span className="font-medium text-fg">
                {groupCharacters.find((c) => c.id === showRemoveConfirm)?.name}
              </span>{" "}
              from the group defaults?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRemoveConfirm(null)}
                disabled={saving}
                className="flex-1 rounded-xl border border-fg/10 bg-fg/5 py-3 text-sm font-medium text-fg transition hover:border-fg/20 hover:bg-fg/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemoveCharacter(showRemoveConfirm)}
                disabled={saving}
                className="flex-1 rounded-xl border border-danger/30 bg-danger/20 py-3 text-sm font-medium text-danger transition hover:bg-danger/30 disabled:opacity-50"
              >
                {saving ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        )}
      </BottomMenu>
    </div>
  );
}
