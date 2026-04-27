export type AiStatus = "idle" | "listening" | "paused" | "stopped" | "repeating";

export interface AiDisplayOptions {
  initialStatus?: AiStatus;
  initialRepeatValue?: string;
  onStatusChange?: (status: AiStatus) => void;
  onRepeatValueChange?: (value: string) => void;
}

export class AiDisplay {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly statusText: HTMLParagraphElement;
  private readonly repeatInput: HTMLInputElement;
  private readonly buttons: Record<AiStatus, HTMLButtonElement>;

  private status: AiStatus;
  private repeatValue: string;
  private readonly onStatusChange?: (status: AiStatus) => void;
  private readonly onRepeatValueChange?: (value: string) => void;

  constructor(options: AiDisplayOptions = {}) {
    this.status = options.initialStatus ?? "idle";
    this.repeatValue = options.initialRepeatValue ?? "";
    this.onStatusChange = options.onStatusChange;
    this.onRepeatValueChange = options.onRepeatValueChange;

    this.root = document.createElement("div");
    this.root.className = "ai-display";
    Object.assign(this.root.style, {
      width: "100%",
      minHeight: "100vh",
      boxSizing: "border-box",
      padding: "24px",
      fontFamily: "Arial, sans-serif",
      background:
        "linear-gradient(180deg, rgb(246 248 252) 0%, rgb(231 237 244) 100%)",
      color: "#15202b",
    });

    const panel = document.createElement("div");
    panel.className = "ai-display-panel";
    Object.assign(panel.style, {
      maxWidth: "720px",
      margin: "0 auto",
      padding: "24px",
      borderRadius: "12px",
      backgroundColor: "#ffffff",
      boxShadow: "0 16px 40px rgba(21, 32, 43, 0.08)",
    });

    this.title = document.createElement("h1");
    this.title.className = "ai-display-title";
    this.title.textContent = "AI Task Controller";
    Object.assign(this.title.style, {
      margin: "0 0 12px",
      fontSize: "32px",
      lineHeight: "1.2",
    });

    this.statusText = document.createElement("p");
    this.statusText.className = "ai-display-status";
    Object.assign(this.statusText.style, {
      margin: "0 0 20px",
      fontSize: "16px",
      color: "#425466",
    });

    const buttonRow = document.createElement("div");
    buttonRow.className = "ai-display-actions";
    Object.assign(buttonRow.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "12px",
      marginBottom: "20px",
    });

    this.buttons = {
      idle: this.createStatusButton("Start", "idle"),
      listening: this.createStatusButton("Listen", "listening"),
      paused: this.createStatusButton("Pause", "paused"),
      stopped: this.createStatusButton("Stop", "stopped"),
      repeating: this.createStatusButton("Repeat", "repeating"),
    };

    buttonRow.append(
      this.buttons.listening,
      this.buttons.paused,
      this.buttons.stopped,
      this.buttons.repeating,
      this.buttons.idle,
    );

    const repeatRow = document.createElement("div");
    repeatRow.className = "ai-display-repeat";
    Object.assign(repeatRow.style, {
      display: "grid",
      gap: "10px",
    });

    const repeatLabel = document.createElement("label");
    repeatLabel.textContent = "Repeat message";
    Object.assign(repeatLabel.style, {
      fontSize: "14px",
      fontWeight: "bold",
      color: "#22303c",
    });

    this.repeatInput = document.createElement("input");
    this.repeatInput.type = "text";
    this.repeatInput.placeholder = "Enter a phrase to repeat";
    this.repeatInput.value = this.repeatValue;
    this.repeatInput.className = "ai-display-repeat-input";
    Object.assign(this.repeatInput.style, {
      width: "100%",
      padding: "12px 14px",
      borderRadius: "8px",
      border: "1px solid #c9d4df",
      boxSizing: "border-box",
      fontSize: "15px",
    });
    this.repeatInput.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      this.repeatValue = target.value;
      this.onRepeatValueChange?.(this.repeatValue);
    });

    const shortcutText = document.createElement("p");
    shortcutText.className = "ai-display-shortcut";
    shortcutText.textContent = "Shortcut: Shift + S to stop the task.";
    Object.assign(shortcutText.style, {
      margin: "12px 0 0",
      fontSize: "13px",
      color: "#5b6b79",
    });

    repeatRow.append(repeatLabel, this.repeatInput, shortcutText);
    panel.append(this.title, this.statusText, buttonRow, repeatRow);
    this.root.append(panel);

    this.updateStatusText();
  }

  mount(container: HTMLElement): void {
    container.append(this.root);
  }

  getElement(): HTMLElement {
    return this.root;
  }

  getStatus(): AiStatus {
    return this.status;
  }

  getRepeatValue(): string {
    return this.repeatValue;
  }

  setStatus(status: AiStatus): void {
    this.status = status;
    this.updateStatusText();
    this.onStatusChange?.(status);
  }

  setRepeatValue(value: string): void {
    this.repeatValue = value;
    this.repeatInput.value = value;
    this.onRepeatValueChange?.(value);
  }

  private createStatusButton(label: string, status: AiStatus): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = "ai-display-button";
    Object.assign(button.style, {
      border: "none",
      borderRadius: "999px",
      padding: "10px 16px",
      backgroundColor: "#15202b",
      color: "#ffffff",
      cursor: "pointer",
      fontSize: "14px",
    });
    button.addEventListener("click", () => {
      this.setStatus(status);
    });
    return button;
  }

  private updateStatusText(): void {
    const repeatSuffix =
      this.status === "repeating" && this.repeatValue.trim().length > 0
        ? ' "' + this.repeatValue.trim() + '"'
        : "";

    this.statusText.textContent =
      "Current status: " + this.status + repeatSuffix + ".";
  }
}

export function createAiDisplay(options?: AiDisplayOptions): AiDisplay {
  return new AiDisplay(options);
}
