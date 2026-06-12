import AppKit
import CxMenuBarCore

@main
@MainActor
enum CxMenuBarMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let model = StatusModel()
    private let iconCache = MenuIconCache()
    private var refreshTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.isVisible = true
        statusItem.button?.imagePosition = .imageLeading

        model.onChange = { [weak self] in
            self?.render()
        }

        render()
        Task { await model.refresh() }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.model.refresh() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        refreshTimer?.invalidate()
    }

    private func render() {
        let state = model.statusBarState
        if let button = statusItem.button {
            button.title = state.title
            button.toolTip = state.tooltip
            button.image = circleImage(for: state.indicator)
        }

        statusItem.menu = makeMenu()
    }

    private func makeMenu() -> NSMenu {
        if let error = model.error {
            return makeErrorMenu(error)
        }

        let menu = NSMenu()
        guard let status = model.status else {
            menu.addItem(disabledItem("Loading..."))
            menu.addItem(.separator())
            menu.addItem(openDashboardItem())
            menu.addItem(actionItem("Refresh", symbol: "arrow.clockwise") { [weak self] in
                self?.refresh()
            })
            menu.addItem(actionItem("Quit", symbol: "power") {
                NSApp.terminate(nil)
            })
            return menu
        }

        let tasks = status.taskWorkspaces
        let plain = status.plainWorkspaces

        if tasks.isEmpty && plain.isEmpty {
            menu.addItem(disabledItem("No running workspaces"))
        } else {
            if !plain.isEmpty {
                menu.addItem(sectionItem("Workspaces"))
                for workspace in plain {
                    menu.addItem(workspaceMenuItem(workspace, status: status))
                }
            }
            if !tasks.isEmpty {
                if !plain.isEmpty {
                    menu.addItem(.separator())
                }
                menu.addItem(sectionItem("Tasks"))
                for workspace in tasks {
                    menu.addItem(taskMenuItem(workspace, status: status))
                }
            }
        }

        menu.addItem(.separator())
        menu.addItem(openDashboardItem())
        menu.addItem(actionItem("Refresh", symbol: "arrow.clockwise", keyEquivalent: "r") { [weak self] in
            self?.refresh()
        })
        menu.addItem(actionItem("Quit", symbol: "power", keyEquivalent: "q") {
            NSApp.terminate(nil)
        })

        return menu
    }

    private func makeErrorMenu(_ error: CxApiError) -> NSMenu {
        let menu = NSMenu()
        menu.addItem(disabledItem(error.menuTitle, symbol: error == .unauthorized ? "lock.slash" : "wifi.exclamationmark"))
        menu.addItem(actionItem("Retry", symbol: "arrow.clockwise") { [weak self] in
            self?.refresh()
        })
        menu.addItem(.separator())
        menu.addItem(openDashboardItem())
        menu.addItem(actionItem("Quit", symbol: "power") {
            NSApp.terminate(nil)
        })
        return menu
    }

    private func openDashboardItem() -> NSMenuItem {
        urlItem("Open Dashboard", symbol: "globe", url: model.webURL.absoluteString)
    }

    private func taskMenuItem(_ workspace: WorkspaceInfo, status: StatusResponse) -> NSMenuItem {
        let task = workspace.task
        let baseTitle = truncated(task?.displayName ?? workspace.name, max: 60)
        let title = workspace.isFavorite ? "★ \(baseTitle)" : baseTitle
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.image = circleImage(for: workspace.indicator)

        let submenu = NSMenu()
        appendHeaderGroup(
            to: submenu,
            workspace: workspace,
            status: status,
            state: task?.state,
            message: task?.message,
            link: task?.resourceLink,
            coderUrl: task?.url
        )
        appendAppsSection(to: submenu, workspace: workspace)
        submenu.addItem(.separator())
        appendWorkspaceSection(to: submenu, workspace: workspace)

        item.submenu = submenu
        return item
    }

    private func workspaceMenuItem(_ workspace: WorkspaceInfo, status: StatusResponse) -> NSMenuItem {
        let layout = status.activeLayout(for: workspace.name)
        let suffix = layout.map { " · \($0.name)" } ?? ""
        let prefix = workspace.isFavorite ? "★ " : ""
        let item = NSMenuItem(title: "\(prefix)\(workspace.name)\(suffix)", action: nil, keyEquivalent: "")
        item.image = circleImage(for: workspace.indicator)

        let submenu = NSMenu()
        appendHeaderGroup(
            to: submenu,
            workspace: workspace,
            status: status,
            state: workspace.appStatus?.state,
            message: workspace.appStatus?.message,
            link: workspace.appStatus?.resourceLink
        )
        appendAppsSection(to: submenu, workspace: workspace)
        submenu.addItem(.separator())
        appendWorkspaceSection(to: submenu, workspace: workspace)

        item.submenu = submenu
        return item
    }

    /// Renders the message detail, then View in cmux, then the resource/task
    /// links as a single group, followed by a separator when non-empty.
    private func appendHeaderGroup(
        to submenu: NSMenu,
        workspace: WorkspaceInfo,
        status: StatusResponse,
        state: String?,
        message: String?,
        link: String?,
        coderUrl: String? = nil
    ) {
        var added = false

        var detailParts: [String] = []
        if let state, !state.isEmpty { detailParts.append(state) }
        if let message, !message.isEmpty { detailParts.append(message) }
        let detail = detailParts.joined(separator: " · ")
        if !detail.isEmpty {
            submenu.addItem(wrappingDetailItem(detail))
            added = true
        }

        if let layout = status.activeLayout(for: workspace.name) {
            submenu.addItem(actionItem("View in cmux", symbol: "arrow.right") { [weak self] in
                self?.perform("Activating \(layout.name)") {
                    await self?.model.activateLayout(layout.name) ?? ActionResponse(ok: false, error: "Menu bar app closed")
                }
            })
            added = true
        }

        if let link, !link.isEmpty {
            submenu.addItem(urlItem(linkLabel(for: link), symbol: "arrow.up.right.square", url: link))
            added = true
        }

        if let coderUrl, !coderUrl.isEmpty {
            submenu.addItem(urlItem("Open in Coder", symbol: "list.bullet.rectangle", url: coderUrl))
            added = true
        }

        if added { submenu.addItem(.separator()) }
    }

    private func appendAppsSection(to submenu: NSMenu, workspace: WorkspaceInfo) {
        submenu.addItem(sectionItem("Apps"))
        var addedApp = false
        if let dashboard = workspace.dashboard {
            addedApp = true
            submenu.addItem(urlItem("Dashboard", symbol: "globe", url: dashboard))
        }
        if workspace.isRunning, let terminal = workspace.terminal {
            addedApp = true
            submenu.addItem(urlItem("Web Terminal", symbol: "terminal", url: terminal))
        }
        if workspace.isRunning {
            for app in workspace.sortedApps {
                addedApp = true
                submenu.addItem(appItem(app))
            }
        }
        if !addedApp {
            submenu.addItem(disabledItem("No apps"))
        }
    }

    private func appendWorkspaceSection(to submenu: NSMenu, workspace: WorkspaceInfo) {
        submenu.addItem(sectionItem("Workspace"))
        if workspace.isRunning {
            submenu.addItem(actionItem("Stop", symbol: "stop.fill") { [weak self] in
                self?.perform("Stopping \(workspace.name)") {
                    await self?.model.stopWorkspace(workspace.name) ?? ActionResponse(ok: false, error: "Menu bar app closed")
                }
            })
        } else {
            submenu.addItem(actionItem("Start", symbol: "play.fill") { [weak self] in
                self?.perform("Starting \(workspace.name)") {
                    await self?.model.startWorkspace(workspace.name) ?? ActionResponse(ok: false, error: "Menu bar app closed")
                }
            })
        }
        submenu.addItem(actionItem("Restart", symbol: "arrow.clockwise") { [weak self] in
            self?.perform("Restarting \(workspace.name)") {
                await self?.model.restartWorkspace(workspace.name) ?? ActionResponse(ok: false, error: "Menu bar app closed")
            }
        })
        submenu.addItem(actionItem("Update", symbol: "arrow.up") { [weak self] in
            self?.perform("Updating \(workspace.name)") {
                await self?.model.updateWorkspace(workspace.name) ?? ActionResponse(ok: false, error: "Menu bar app closed")
            }
        })
        let pinned = workspace.isFavorite
        submenu.addItem(actionItem(pinned ? "Unpin" : "Pin to Top", symbol: pinned ? "star.slash" : "star") { [weak self] in
            self?.perform(pinned ? "Unpinning \(workspace.name)" : "Pinning \(workspace.name)") {
                await self?.model.setFavorite(workspace.name, favorite: !pinned) ?? ActionResponse(ok: false, error: "Menu bar app closed")
            }
        })
    }

    private func refresh() {
        Task { await model.refresh() }
    }

    private func perform(_ label: String, operation: @escaping () async -> ActionResponse) {
        Task {
            let result = await operation()
            guard !result.ok else { return }
            showFailure(label: label, message: result.error ?? "Failed")
        }
    }

    private func showFailure(label: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "\(label) failed"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func urlItem(_ title: String, symbol: String, url: String) -> NSMenuItem {
        actionItem(title, symbol: symbol) {
            guard let target = URL(string: url) else { return }
            NSWorkspace.shared.open(target)
        }
    }

    private func appItem(_ app: WorkspaceApp) -> NSMenuItem {
        let item = urlItem(app.label, symbol: "macwindow", url: app.url)
        guard let icon = app.icon, !icon.isEmpty else {
            return item
        }

        Task { [iconCache] in
            if let image = await iconCache.image(for: icon) {
                item.image = image
            }
        }

        return item
    }

    private func actionItem(
        _ title: String,
        symbol: String? = nil,
        keyEquivalent: String = "",
        action: @escaping () -> Void
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(runAction(_:)), keyEquivalent: keyEquivalent)
        item.target = self
        item.representedObject = MenuAction(action)
        item.image = symbol.flatMap(symbolImage)
        if keyEquivalent == "r" || keyEquivalent == "q" {
            item.keyEquivalentModifierMask = .command
        }
        return item
    }

    private func disabledItem(_ title: String, symbol: String? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.image = symbol.flatMap(symbolImage)
        return item
    }

    /// A disabled, word-wrapping detail row. Menu items don't wrap their title,
    /// so this hosts a multi-line NSTextField as a custom view.
    private func wrappingDetailItem(_ text: String) -> NSMenuItem {
        let leftInset: CGFloat = 21
        let rightInset: CGFloat = 12
        let vInset: CGFloat = 4
        let wrapWidth: CGFloat = 320

        let label = NSTextField(wrappingLabelWithString: text)
        label.font = NSFont.menuFont(ofSize: 0)
        label.textColor = .secondaryLabelColor
        label.isEditable = false
        label.isSelectable = false
        label.drawsBackground = false
        label.maximumNumberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.preferredMaxLayoutWidth = wrapWidth

        let fitting = label.sizeThatFits(NSSize(width: wrapWidth, height: .greatestFiniteMagnitude))
        let height = ceil(fitting.height)
        label.frame = NSRect(x: leftInset, y: vInset, width: wrapWidth, height: height)

        let container = NSView(frame: NSRect(
            x: 0,
            y: 0,
            width: leftInset + wrapWidth + rightInset,
            height: height + vInset * 2
        ))
        container.addSubview(label)

        let item = NSMenuItem()
        item.isEnabled = false
        item.view = container
        return item
    }

    private func sectionItem(_ title: String) -> NSMenuItem {
        let item = disabledItem(title)
        item.attributedTitle = NSAttributedString(
            string: title,
            attributes: [
                .font: NSFont.menuFont(ofSize: NSFont.smallSystemFontSize),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
        )
        return item
    }

    @objc private func runAction(_ sender: NSMenuItem) {
        (sender.representedObject as? MenuAction)?.run()
    }

    private func symbolImage(_ name: String) -> NSImage? {
        NSImage(systemSymbolName: name, accessibilityDescription: nil)
    }

    private func truncated(_ text: String, max: Int) -> String {
        guard text.count > max else { return text }
        return String(text.prefix(max - 1)) + "…"
    }

    private func circleImage(for indicator: StatusIndicator) -> NSImage {
        switch indicator {
        case .healthy:
            return circleImage(color: .systemGreen)
        case .unhealthy:
            return circleImage(color: .systemRed)
        case .inactive:
            return circleImage(color: .secondaryLabelColor)
        }
    }

    private func circleImage(for indicator: WorkspaceIndicator) -> NSImage {
        switch indicator {
        case .runningHealthy:
            return circleImage(color: .systemGreen)
        case .runningUnhealthy:
            return circleImage(color: .systemRed)
        case .busy:
            return circleImage(color: .systemYellow)
        case .failed:
            return circleImage(color: .systemRed)
        case .inactive:
            return circleImage(color: .secondaryLabelColor)
        }
    }

    private func circleImage(color: NSColor) -> NSImage {
        let size = NSSize(width: 12, height: 12)
        let image = NSImage(size: size)
        image.lockFocus()
        color.setFill()
        NSBezierPath(ovalIn: NSRect(x: 2, y: 2, width: 8, height: 8)).fill()
        image.unlockFocus()
        image.isTemplate = false
        return image
    }
}

private final class MenuAction: NSObject {
    private let action: () -> Void

    init(_ action: @escaping () -> Void) {
        self.action = action
    }

    func run() {
        action()
    }
}

@MainActor
private final class MenuIconCache {
    private var cache: [String: NSImage?] = [:]

    func image(for icon: String) async -> NSImage? {
        if let cached = cache[icon] {
            return cached
        }

        guard let url = URL(string: icon) else {
            cache[icon] = nil
            return nil
        }

        let data: Data
        do {
            (data, _) = try await URLSession.shared.data(from: url)
        } catch {
            cache[icon] = nil
            return nil
        }

        guard let image = NSImage(data: data) else {
            cache[icon] = nil
            return nil
        }

        image.size = NSSize(width: 16, height: 16)
        image.isTemplate = false
        cache[icon] = image
        return image
    }
}
