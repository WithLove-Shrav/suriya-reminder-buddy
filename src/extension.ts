import * as vscode from 'vscode';
import * as path from 'path';
import { Store } from './store';
import { Companion } from './companion';
import { CompanionView } from './view';
import { Buddy } from './buddy';
import type { Kind } from './types';

export function activate(ctx: vscode.ExtensionContext): void {
  // globalStorageUri is per-user (not per-workspace), so every window shares one state file.
  const store = new Store(path.join(ctx.globalStorageUri.fsPath, 'state.json'));
  const companion = new Companion(store);
  const view = new CompanionView(ctx.extensionUri, companion);
  // Floating desktop buddy; answers clicked there come back here (stale ids are ignored by the companion).
  const buddy = new Buddy(ctx.extensionUri.fsPath, (id, answer) => companion.answer(id, answer));
  companion.hasSurface = () => view.visible || buddy.connected;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'reminderCompanion.toggle';
  const refreshStatus = () => {
    const s = companion.statusText();
    status.text = s.text;
    status.tooltip = s.tooltip;
  };
  refreshStatus();
  status.show();

  ctx.subscriptions.push(
    companion,
    buddy,
    status,
    companion.onDidChange(refreshStatus),
    companion.onDidChange(() => void buddy.sync(companion.model())),
    vscode.window.registerWebviewViewProvider(CompanionView.viewType, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('reminderCompanion.toggle', () => companion.toggle()),
    vscode.commands.registerCommand('reminderCompanion.openView', () => vscode.commands.executeCommand('reminderCompanion.view.focus')),
    vscode.commands.registerCommand('reminderCompanion.simulateWelcomeBack', () => companion.simulateWelcomeBack()),
    vscode.commands.registerCommand('reminderCompanion.nudgeNow', () => companion.nudgeNow()),
    vscode.commands.registerCommand('reminderCompanion.nudgeChoose', async () => {
      const items: { label: string; nudge: Kind }[] = [
        { label: '💧 Water', nudge: 'water' },
        { label: '👀 Eye break', nudge: 'break' },
        { label: '🙆 Stretch', nudge: 'stretch' },
        { label: '🚶 Walk', nudge: 'walk' },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Which nudge do you want to see?' });
      if (pick) companion.nudgeNow(pick.nudge);
    }),
  );

  void buddy.ensure(); // start/connect early so the first nudge already has somewhere to appear
  companion.start();
}

export function deactivate(): void {}
