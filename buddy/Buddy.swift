// Floating desktop buddy: a transparent, always-on-top, non-activating window that shows the avatar and a
// speech bubble. It never takes keyboard focus, so clicking "Yes" doesn't pull you out of your editor or terminal.
// One instance serves every IDE window: they talk to it over a unix socket (newline-delimited JSON).
import Cocoa
import WebKit
import Darwin

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: name), i + 1 < a.count { return a[i + 1] }
    return nil
}

final class FirstMouseWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class Server {
    private var fd: Int32 = -1
    private var lockFd: Int32 = -1
    private var clients = Set<Int32>()
    private let lock = NSLock()
    var onMessage: (([String: Any]) -> Void)?
    var onClientsChanged: ((Int) -> Void)?

    /// Returns false if another instance already owns the socket.
    func start(path: String) -> Bool {
        lockFd = open(path + ".lock", O_CREAT | O_RDWR, 0o600)
        guard lockFd >= 0, flock(lockFd, LOCK_EX | LOCK_NB) == 0 else { return false }
        unlink(path)
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else { return false }
        withUnsafeMutablePointer(to: &addr.sun_path) { p in
            p.withMemoryRebound(to: CChar.self, capacity: bytes.count) { dst in
                for (i, b) in bytes.enumerated() { dst[i] = b }
            }
        }
        addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard rc == 0, listen(fd, 8) == 0 else { return false }
        chmod(path, 0o600)
        Thread.detachNewThread { [self] in acceptLoop() }
        return true
    }

    private func acceptLoop() {
        while true {
            let c = accept(fd, nil, nil)
            if c < 0 { usleep(20_000); continue }
            var one: Int32 = 1
            setsockopt(c, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
            lock.lock(); clients.insert(c); let n = clients.count; lock.unlock()
            DispatchQueue.main.async { self.onClientsChanged?(n) }
            Thread.detachNewThread { [self] in readLoop(c) }
        }
    }

    private func readLoop(_ c: Int32) {
        var buf = [UInt8](repeating: 0, count: 8192)
        var acc = Data()
        while true {
            let n = read(c, &buf, buf.count)
            if n <= 0 { break }
            acc.append(buf, count: n)
            while let nl = acc.firstIndex(of: 10) {
                let line = acc.subdata(in: acc.startIndex..<nl)
                acc.removeSubrange(acc.startIndex...nl)
                if let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] {
                    DispatchQueue.main.async { self.onMessage?(obj) }
                }
            }
        }
        close(c)
        lock.lock(); clients.remove(c); let n = clients.count; lock.unlock()
        DispatchQueue.main.async { self.onClientsChanged?(n) }
    }

    func broadcast(_ obj: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        data.append(10)
        lock.lock(); let cs = Array(clients); lock.unlock()
        for c in cs { data.withUnsafeBytes { _ = write(c, $0.baseAddress, data.count) } }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var panel: Panel!
    var web: FirstMouseWebView!
    let server = Server()
    var loaded = false
    var pendingJS: [String] = []
    var hideTimer: Timer?
    var quitTimer: Timer?
    var corner = "bottom-right"
    var socketPath = ""
    let size = NSSize(width: 340, height: 440)

    func applicationDidFinishLaunching(_ n: Notification) {
        signal(SIGPIPE, SIG_IGN)
        guard let sock = arg("--socket"), let root = arg("--root") else { exit(2) }
        socketPath = sock
        guard server.start(path: sock) else { exit(0) } // another buddy is already running
        server.onMessage = { [weak self] m in self?.handle(m) }
        server.onClientsChanged = { [weak self] n in self?.clientsChanged(n) }
        clientsChanged(0)

        let cfg = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.add(self, name: "buddy")
        cfg.userContentController = ucc
        web = FirstMouseWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self

        panel = Panel(contentRect: NSRect(origin: .zero, size: size),
                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.contentView = web
        panel.alphaValue = 0

        let rootURL = URL(fileURLWithPath: root)
        web.loadFileURL(rootURL.appendingPathComponent("buddy/buddy.html"), allowingReadAccessTo: rootURL)
    }

    func applicationWillTerminate(_ n: Notification) { unlink(socketPath) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        pendingJS.forEach { web.evaluateJavaScript($0) }
        pendingJS.removeAll()
    }

    func run(_ js: String) {
        if loaded { web.evaluateJavaScript(js) } else { pendingJS.append(js) }
    }

    func clientsChanged(_ n: Int) {
        quitTimer?.invalidate()
        if n == 0 {
            // Nobody is connected (all IDE windows closed): don't linger.
            quitTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in NSApp.terminate(nil) }
        }
    }

    func handle(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "show":
            if let c = m["corner"] as? String { corner = c }
            let ttl = (m["ttl"] as? Double) ?? 600_000
            if let data = try? JSONSerialization.data(withJSONObject: m), let s = String(data: data, encoding: .utf8) {
                run("window.renderBuddy(\(s))")
            }
            present()
            hideTimer?.invalidate()
            hideTimer = Timer.scheduledTimer(withTimeInterval: ttl / 1000, repeats: false) { [weak self] _ in self?.dismiss() }
        case "hide":
            dismiss()
        case "quit":
            NSApp.terminate(nil)
        case "selftest": // lets tests press the bubble's buttons without a real mouse click
            if let a = m["answer"] as? String, a == "yes" || a == "no" { run("document.getElementById('\(a)').click()") }
        default:
            break
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "answer" else { return }
        server.broadcast(["type": "answer", "id": body["id"] ?? "", "answer": body["answer"] ?? ""])
        // If nothing replaces the bubble shortly (e.g. the owning window closed), tidy it away.
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in self?.dismiss() }
    }

    func present() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
        let vf = screen.visibleFrame
        let margin: CGFloat = 12
        let x = corner.hasSuffix("left") ? vf.minX + margin : vf.maxX - size.width - margin
        let y = corner.hasPrefix("top") ? vf.maxY - size.height - margin : vf.minY + margin
        panel.setFrameOrigin(NSPoint(x: x, y: y))
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.2
            panel.animator().alphaValue = 1
        }
    }

    func dismiss() {
        hideTimer?.invalidate()
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.25
            self.panel.animator().alphaValue = 0
        }, completionHandler: {
            if self.panel.alphaValue == 0 { self.panel.orderOut(nil) }
        })
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
