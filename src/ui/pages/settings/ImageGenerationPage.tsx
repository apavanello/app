import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Image, LucideIcon, Sparkles } from "lucide-react";

import { BottomMenu } from "../../components/BottomMenu";
import { resolveImageGenerationOptions } from "../../../core/image-generation";
import { readSettings, saveAdvancedSettings } from "../../../core/storage/repo";
import type { Model } from "../../../core/storage/schemas";
import { useI18n } from "../../../core/i18n/context";
import { getProviderIcon } from "../../../core/utils/providerIcons";
import { cn } from "../../design-tokens";

interface ImageGenerationState {
  loading: boolean;
  error: string | null;
  models: Model[];
  avatarModelId: string | null;
  sceneModelId: string | null;
}

type SelectorKey = "avatarModelId" | "sceneModelId";

type SelectorCardProps = {
  title: string;
  description: string;
  selectedModel: Model | null;
  fallbackLabel: string;
  icon: LucideIcon;
  accentClassName: string;
  onClick: () => void;
};

function SelectorCard({
  title,
  description,
  selectedModel,
  fallbackLabel,
  icon: Icon,
  accentClassName,
  onClick,
}: SelectorCardProps) {
  return (
    <section className="space-y-3 rounded-xl border border-fg/10 bg-fg/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className={cn("rounded-lg border p-1.5", accentClassName)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-fg/45">{description}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between rounded-xl border border-fg/10 bg-surface-el/20 px-3.5 py-3 text-left transition hover:bg-surface-el/30 focus:border-fg/25 focus:outline-none"
      >
        <div className="flex min-w-0 items-center gap-2">
          {selectedModel ? getProviderIcon(selectedModel.providerId) : <Icon className="h-5 w-5 text-fg/40" />}
          <div className="min-w-0">
            <span className={cn("block truncate text-sm", selectedModel ? "text-fg" : "text-fg/50")}>
              {selectedModel?.displayName || selectedModel?.name || fallbackLabel}
            </span>
            {selectedModel && (
              <span className="block truncate text-xs text-fg/40">{selectedModel.name}</span>
            )}
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-fg/40" />
      </button>
    </section>
  );
}

type ModelSelectionMenuProps = {
  isOpen: boolean;
  title: string;
  models: Model[];
  selectedModelId: string | null;
  searchQuery: string;
  emptyLabel: string;
  fallbackLabel: string;
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (modelId: string | null) => void;
};

function ModelSelectionMenu({
  isOpen,
  title,
  models,
  selectedModelId,
  searchQuery,
  emptyLabel,
  fallbackLabel,
  onClose,
  onSearchChange,
  onSelect,
}: ModelSelectionMenuProps) {
  const filteredModels = useMemo(() => {
    if (!searchQuery) return models;
    const q = searchQuery.toLowerCase();
    return models.filter(
      (model) =>
        model.displayName?.toLowerCase().includes(q) || model.name?.toLowerCase().includes(q),
    );
  }, [models, searchQuery]);

  return (
    <BottomMenu isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={fallbackLabel}
            className="w-full rounded-xl border border-fg/10 bg-surface-el/30 px-4 py-2.5 pl-10 text-sm text-fg placeholder-fg/40 focus:border-fg/20 focus:outline-none"
          />
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
              !selectedModelId ? "border-accent/40 bg-accent/10" : "border-fg/10 bg-fg/5 hover:bg-fg/10",
            )}
          >
            <Image className="h-5 w-5 text-fg/40" />
            <span className="text-sm text-fg">{emptyLabel}</span>
            {!selectedModelId && <Check className="ml-auto h-4 w-4 text-accent/80" />}
          </button>

          {filteredModels.map((model) => (
            <button
              key={model.id}
              onClick={() => onSelect(model.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
                selectedModelId === model.id
                  ? "border-accent/40 bg-accent/10"
                  : "border-fg/10 bg-fg/5 hover:bg-fg/10",
              )}
            >
              {getProviderIcon(model.providerId)}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">
                  {model.displayName || model.name}
                </span>
                <span className="block truncate text-xs text-fg/40">{model.name}</span>
              </div>
              {selectedModelId === model.id && <Check className="h-4 w-4 shrink-0 text-accent/80" />}
            </button>
          ))}
        </div>
      </div>
    </BottomMenu>
  );
}

export function ImageGenerationPage() {
  const { t } = useI18n();
  const [state, setState] = useState<ImageGenerationState>({
    loading: true,
    error: null,
    models: [],
    avatarModelId: null,
    sceneModelId: null,
  });
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showSceneMenu, setShowSceneMenu] = useState(false);
  const [avatarSearchQuery, setAvatarSearchQuery] = useState("");
  const [sceneSearchQuery, setSceneSearchQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const settings = await readSettings();
        const options = resolveImageGenerationOptions(settings);
        setState({
          loading: false,
          error: null,
          models: options.models,
          avatarModelId: settings.advancedSettings?.avatarGenerationModelId ?? null,
          sceneModelId: settings.advancedSettings?.sceneGenerationModelId ?? null,
        });
      } catch (err) {
        console.error("Failed to load image generation settings:", err);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load settings",
        }));
      }
    };

    void load();
  }, []);

  const persistSelection = async (key: SelectorKey, modelId: string | null) => {
    setState((prev) => ({
      ...prev,
      [key]: modelId,
      error: null,
    }));

    try {
      const settings = await readSettings();
      await saveAdvancedSettings({
        ...(settings.advancedSettings ?? {}),
        avatarGenerationModelId:
          key === "avatarModelId" ? modelId ?? undefined : settings.advancedSettings?.avatarGenerationModelId,
        sceneGenerationModelId:
          key === "sceneModelId" ? modelId ?? undefined : settings.advancedSettings?.sceneGenerationModelId,
      });
    } catch (err) {
      console.error("Failed to save image generation settings:", err);
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Failed to save image generation settings",
      }));
    }
  };

  const selectedAvatarModel = state.avatarModelId
    ? state.models.find((model) => model.id === state.avatarModelId) ?? null
    : null;
  const selectedSceneModel = state.sceneModelId
    ? state.models.find((model) => model.id === state.sceneModelId) ?? null
    : null;

  if (state.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg/10 border-t-fg/60" />
      </div>
    );
  }

  if (state.models.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-fg/10 bg-fg/5">
          <Image className="h-8 w-8 text-fg/40" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-fg">{t("imageGeneration.empty.title")}</h2>
        <p className="text-center text-sm text-fg/50">{t("imageGeneration.empty.description")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 px-4 pb-24 pt-4">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          {state.error && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 p-3">
              <p className="text-xs leading-relaxed text-danger/80">{state.error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SelectorCard
              title={t("imageGeneration.sections.avatar.title")}
              description={t("imageGeneration.sections.avatar.description")}
              selectedModel={selectedAvatarModel}
              fallbackLabel={t("imageGeneration.labels.useFirstAvailable")}
              icon={Image}
              accentClassName="border-warning/30 bg-warning/10 text-warning/80"
              onClick={() => setShowAvatarMenu(true)}
            />

            <SelectorCard
              title={t("imageGeneration.sections.scene.title")}
              description={t("imageGeneration.sections.scene.description")}
              selectedModel={selectedSceneModel}
              fallbackLabel={t("imageGeneration.labels.useFirstAvailable")}
              icon={Sparkles}
              accentClassName="border-accent/30 bg-accent/10 text-accent/80"
              onClick={() => setShowSceneMenu(true)}
            />
          </div>
        </div>
      </main>

      <ModelSelectionMenu
        isOpen={showAvatarMenu}
        title={t("imageGeneration.labels.selectAvatarModel")}
        models={state.models}
        selectedModelId={state.avatarModelId}
        searchQuery={avatarSearchQuery}
        emptyLabel={t("imageGeneration.labels.useFirstAvailable")}
        fallbackLabel={t("imageGeneration.labels.searchModels")}
        onClose={() => {
          setShowAvatarMenu(false);
          setAvatarSearchQuery("");
        }}
        onSearchChange={setAvatarSearchQuery}
        onSelect={(modelId) => {
          void persistSelection("avatarModelId", modelId);
          setShowAvatarMenu(false);
          setAvatarSearchQuery("");
        }}
      />

      <ModelSelectionMenu
        isOpen={showSceneMenu}
        title={t("imageGeneration.labels.selectSceneModel")}
        models={state.models}
        selectedModelId={state.sceneModelId}
        searchQuery={sceneSearchQuery}
        emptyLabel={t("imageGeneration.labels.useFirstAvailable")}
        fallbackLabel={t("imageGeneration.labels.searchModels")}
        onClose={() => {
          setShowSceneMenu(false);
          setSceneSearchQuery("");
        }}
        onSearchChange={setSceneSearchQuery}
        onSelect={(modelId) => {
          void persistSelection("sceneModelId", modelId);
          setShowSceneMenu(false);
          setSceneSearchQuery("");
        }}
      />
    </div>
  );
}
