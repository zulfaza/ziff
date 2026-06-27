import { Check, ExternalLink, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { KEYBINDING_COMMANDS, commandLabel } from "../keybindings";
import { shortcutLabelForCommand } from "../keybindingsRuntime";
import type { ResolvedKeybindingsConfig, UserSettings } from "../shared";

type SettingsTab = "general" | "keybindings";

export function SettingsModal({
  keybindings,
  keybindingsPath,
  onClose,
  onOpenKeybindingsConfig,
  onResetKeybindings,
  onResetSettings,
  onUpdateSettings,
  settings,
}: {
  keybindings: ResolvedKeybindingsConfig;
  keybindingsPath: string;
  onClose(): void;
  onOpenKeybindingsConfig(): void;
  onResetKeybindings(): void;
  onResetSettings(): void;
  onUpdateSettings(patch: Partial<UserSettings>): void;
  settings: UserSettings;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings-overlay" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button aria-label="Close settings" className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-body">
          <nav aria-label="Settings sections" className="settings-nav">
            <button
              className={tab === "general" ? "settings-nav-item active" : "settings-nav-item"}
              onClick={() => setTab("general")}
            >
              General
            </button>
            <button
              className={tab === "keybindings" ? "settings-nav-item active" : "settings-nav-item"}
              onClick={() => setTab("keybindings")}
            >
              Keybindings
            </button>
          </nav>

          <div className="settings-panel">
            {tab === "general" ? (
              <GeneralSettingsPanel
                onResetSettings={onResetSettings}
                onUpdateSettings={onUpdateSettings}
                settings={settings}
              />
            ) : (
              <KeybindingsSettingsPanel
                keybindings={keybindings}
                keybindingsPath={keybindingsPath}
                onOpenKeybindingsConfig={onOpenKeybindingsConfig}
                onResetKeybindings={onResetKeybindings}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function GeneralSettingsPanel({
  onResetSettings,
  onUpdateSettings,
  settings,
}: {
  onResetSettings(): void;
  onUpdateSettings(patch: Partial<UserSettings>): void;
  settings: UserSettings;
}) {
  return (
    <>
      <div className="settings-panel-header">
        <h3>General</h3>
        <button className="link-button settings-reset-button" onClick={onResetSettings}>
          <RotateCcw size={14} />
          Restore defaults
        </button>
      </div>

      <section className="settings-section">
        <div className="settings-section-title">Diff</div>
        <SettingChoiceRow
          label="Default layout"
          onChange={(defaultViewMode) => onUpdateSettings({ defaultViewMode })}
          options={[
            { label: "Split", value: "split" },
            { label: "Stacked", value: "stacked" },
          ]}
          value={settings.defaultViewMode}
        />
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Startup</div>
        <SettingToggleRow
          checked={settings.restoreLastRepo}
          label="Re-open last project on launch"
          onChange={(restoreLastRepo) => onUpdateSettings({ restoreLastRepo })}
        />
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Changes sidebar</div>
        <SettingChoiceRow
          label="File list view"
          onChange={(fileListView) => onUpdateSettings({ fileListView })}
          options={[
            { label: "List", value: "list" },
            { label: "Tree", value: "tree" },
          ]}
          value={settings.fileListView}
        />
        <SettingChoiceRow
          label="Group by"
          onChange={(fileGroupBy) => onUpdateSettings({ fileGroupBy })}
          options={[
            { label: "None", value: "none" },
            { label: "Status", value: "status" },
          ]}
          value={settings.fileGroupBy}
        />
      </section>
    </>
  );
}

function KeybindingsSettingsPanel({
  keybindings,
  keybindingsPath,
  onOpenKeybindingsConfig,
  onResetKeybindings,
}: {
  keybindings: ResolvedKeybindingsConfig;
  keybindingsPath: string;
  onOpenKeybindingsConfig(): void;
  onResetKeybindings(): void;
}) {
  const rows = useMemo(
    () =>
      KEYBINDING_COMMANDS.map((command) => ({
        command,
        label: commandLabel(command),
        shortcut: shortcutLabelForCommand(keybindings, command),
      })),
    [keybindings],
  );

  return (
    <>
      <div className="settings-panel-header">
        <h3>Keybindings</h3>
        <div className="settings-actions">
          <button className="link-button settings-reset-button" onClick={onResetKeybindings}>
            <RotateCcw size={14} />
            Restore defaults
          </button>
          <button className="link-button settings-reset-button" onClick={onOpenKeybindingsConfig}>
            <ExternalLink size={14} />
            Open keybindings.json
          </button>
        </div>
      </div>

      <p className="settings-help">
        Edit shortcuts in <code>{keybindingsPath}</code>. Changes reload automatically.
      </p>

      <div className="keybindings-table">
        {rows.map((row) => (
          <div className="keybindings-row" key={row.command}>
            <span className="keybindings-label">{row.label}</span>
            <span className="keybindings-shortcut">{row.shortcut ?? "Unassigned"}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function SettingChoiceRow<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange(value: T): void;
  options: readonly { label: string; value: T }[];
  value: T;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="settings-choice-list">
        {options.map((option) => (
          <button
            className={option.value === value ? "settings-choice active" : "settings-choice"}
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {option.value === value ? <Check size={14} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingToggleRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="settings-row settings-toggle-row">
      <span className="settings-row-label">{label}</span>
      <input checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />
    </label>
  );
}
