import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import type { Companion } from './companion';
import { POSES, resolvePose } from './poses';

export class CompanionView implements vscode.WebviewViewProvider {
  static readonly viewType = 'reminderCompanion.view';
  private view?: vscode.WebviewView;

  constructor(private readonly ext: vscode.Uri, private readonly companion: Companion) {
    companion.onDidChange(() => this.push());
  }

  get visible(): boolean {
    return !!this.view?.visible;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const assets = vscode.Uri.joinPath(this.ext, 'assets');
    view.webview.options = { enableScripts: true, localResourceRoots: [assets] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => {
      switch (m?.type) {
        case 'ready':
          this.push();
          break;
        case 'answer':
          if (m.answer === 'yes' || m.answer === 'no') this.companion.answer(String(m.id), m.answer);
          break;
        case 'toggle':
          void this.companion.toggle();
          break;
        case 'nudge':
          this.companion.nudgeNow();
          break;
      }
    });
    view.onDidChangeVisibility(() => view.visible && this.push());
    view.onDidDispose(() => (this.view = undefined));
  }

  private poses(webview: vscode.Webview): Record<string, { src: string; fx: string }> {
    const dir = vscode.Uri.joinPath(this.ext, 'assets');
    const out: Record<string, { src: string; fx: string }> = {};
    for (const p of POSES) {
      const { use, fx } = resolvePose(dir.fsPath, p);
      out[p] = { src: webview.asWebviewUri(vscode.Uri.joinPath(dir, `${use}.png`)).toString(), fx };
    }
    return out;
  }

  private push(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'model', model: this.companion.model(), poses: this.poses(this.view.webview) });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { padding: 12px 14px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .stage { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .bubble { position: relative; width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; line-height: 1.45;
            background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, #8884)); }
  .bubble::after { content: ""; position: absolute; left: 50%; bottom: -7px; width: 12px; height: 12px; transform: translateX(-50%) rotate(45deg);
            background: var(--vscode-editorWidget-background); border-right: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, #8884));
            border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, #8884)); }
  .bubble.ask { border-color: var(--vscode-focusBorder); }
  .avatar { width: 100%; max-width: 210px; height: auto; margin-top: 4px; animation: float 3.2s ease-in-out infinite; transform-origin: 50% 100%; user-select: none; }
  .avatar.bounce { animation: bounce 0.7s ease-out 2, float 3.2s ease-in-out 1.4s infinite; }
  .avatar.dim { opacity: .72; animation: sway 4s ease-in-out infinite; }
  .avatar.talk { animation: wiggle .6s ease-out 1, float 3.2s ease-in-out .6s infinite; }
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
  @keyframes bounce { 0% { transform: translateY(0) scale(1); } 40% { transform: translateY(-16px) scale(1.04); } 100% { transform: translateY(0) scale(1); } }
  @keyframes wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }
  @keyframes sway { 0%,100% { transform: rotate(-1.2deg); } 50% { transform: rotate(1.2deg); } }
  @media (prefers-reduced-motion: reduce) { .avatar { animation: none !important; } }
  .actions { display: flex; gap: 8px; width: 100%; }
  .actions button { flex: 1; }
  button { padding: 6px 10px; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font: inherit;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  [hidden] { display: none !important; }
  .footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--vscode-widget-border, #8884); display: flex; flex-direction: column; gap: 8px; }
  .stats { color: var(--vscode-descriptionForeground); font-size: .92em; text-align: center; }
  .row { display: flex; gap: 8px; }
  .row button { flex: 1; }
</style></head>
<body>
  <div class="stage">
    <div id="bubble" class="bubble" role="status" aria-live="polite">Waking up…</div>
    <img id="avatar" class="avatar" alt="Your companion" draggable="false">
    <div id="actions" class="actions" hidden>
      <button id="yes">Yes</button>
      <button id="no" class="secondary">Not now</button>
    </div>
  </div>
  <div class="footer">
    <div id="stats" class="stats"></div>
    <div class="row">
      <button id="nudge" class="secondary">Nudge me now</button>
      <button id="toggle" class="secondary">Disable</button>
    </div>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let model = null, poses = null, lastNudgeId = null;
  $('yes').onclick = () => model && model.nudge && vscode.postMessage({ type: 'answer', id: model.nudge.id, answer: 'yes' });
  $('no').onclick = () => model && model.nudge && vscode.postMessage({ type: 'answer', id: model.nudge.id, answer: 'no' });
  $('toggle').onclick = () => vscode.postMessage({ type: 'toggle' });
  $('nudge').onclick = () => vscode.postMessage({ type: 'nudge' });
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'model') { model = e.data.model; poses = e.data.poses; render(); }
  });
  function render() {
    const m = model, active = m.nudge || m.reaction;
    const pose = poses[active ? active.pose : m.ambientPose];
    const img = $('avatar');
    if (img.getAttribute('src') !== pose.src) img.setAttribute('src', pose.src);
    const isNew = m.nudge && m.nudge.id !== lastNudgeId;
    img.className = 'avatar ' + pose.fx;
    if (isNew) { void img.offsetWidth; img.classList.add('talk'); }
    lastNudgeId = m.nudge ? m.nudge.id : null;
    $('bubble').textContent = m.nudge ? m.nudge.text : m.reaction ? m.reaction.text : m.ambient;
    $('bubble').classList.toggle('ask', !!m.nudge);
    $('actions').hidden = !m.nudge;
    $('toggle').textContent = m.enabled ? 'Disable' : 'Enable';
    const y = m.yesToday, h = (m.activeMinutes / 60).toFixed(1);
    $('stats').textContent = 'Today: 💧 ' + y.water + '  👀 ' + y.break + '  🙆 ' + y.stretch + '  🚶 ' + y.walk + '  ·  ' + h + 'h active';
  }
  vscode.postMessage({ type: 'ready' });
</script>
</body></html>`;
  }
}
