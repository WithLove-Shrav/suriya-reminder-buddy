// Minimal stand-in for the `vscode` module so the companion engine can be tested outside the editor.
export const config: Record<string, unknown> = {};
export const shown: string[] = [];
export const handlers: Record<string, (e?: any) => void> = {};

class Emitter<T> {
  private fns: ((e: T) => void)[] = [];
  event = (fn: (e: T) => void) => {
    this.fns.push(fn);
    return { dispose() {} };
  };
  fire(e?: T) {
    this.fns.forEach((f) => f(e as T));
  }
  dispose() {}
}
export const EventEmitter = Emitter;
const reg = (name: string) => (fn: (e?: any) => void) => {
  handlers[name] = fn;
  return { dispose() {} };
};
export const window = {
  state: { focused: true },
  onDidChangeWindowState: reg('focus'),
  onDidChangeTextEditorSelection: reg('selection'),
  onDidChangeTextEditorVisibleRanges: reg('ranges'),
  onDidChangeActiveTextEditor: reg('editor'),
  onDidOpenTerminal: reg('term'),
  onDidChangeActiveTerminal: reg('term2'),
  showInformationMessage: (text: string) => {
    shown.push(text);
    return Promise.resolve(undefined);
  },
};
export const workspace = {
  onDidChangeTextDocument: reg('text'),
  onDidChangeConfiguration: reg('config'),
  getConfiguration: () => ({
    get: (k: string, d: unknown) => (k in config ? config[k] : d),
    update: async (k: string, v: unknown) => {
      config[k] = v;
    },
  }),
};
export const tasks = { onDidStartTask: reg('task') };
export const debug = { onDidStartDebugSession: reg('debug') };
export const ConfigurationTarget = { Global: 1 };
