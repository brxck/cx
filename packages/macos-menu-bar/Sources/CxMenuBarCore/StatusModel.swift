import Foundation

@MainActor
public final class StatusModel {
    public private(set) var status: StatusResponse?
    public private(set) var error: CxApiError?
    public private(set) var isLoading = false

    public var onChange: (() -> Void)?

    private let client: CxApiClient

    public init(client: CxApiClient = CxApiClient()) {
        self.client = client
    }

    /// Base URL of the `cx serve` web UI, for opening in a browser.
    public var webURL: URL {
        client.webURL
    }

    public var statusBarState: StatusBarState {
        if let error {
            return .degraded("?", tooltip: error.menuTitle)
        }

        guard let status else {
            return .degraded("0", tooltip: "cx · loading")
        }

        return status.statusBarState
    }

    public func refresh() async {
        isLoading = true
        notify()

        do {
            let nextStatus = try await client.getStatus()
            status = nextStatus
            error = nil
        } catch let apiError as CxApiError {
            error = apiError
        } catch let unknownError {
            error = .unreachable(String(describing: unknownError))
        }

        isLoading = false
        notify()
    }

    public func activateLayout(_ layout: String) async -> ActionResponse {
        await performAndRefresh {
            let response = try await client.activateLayout(layout)
            return ActionResponse(ok: response.ok, error: response.error)
        }
    }

    public func startWorkspace(_ workspace: String) async -> ActionResponse {
        await performAndRefresh {
            try await client.startWorkspace(workspace)
        }
    }

    public func stopWorkspace(_ workspace: String) async -> ActionResponse {
        await performAndRefresh {
            try await client.stopWorkspace(workspace)
        }
    }

    public func restartWorkspace(_ workspace: String) async -> ActionResponse {
        await performAndRefresh {
            try await client.restartWorkspace(workspace)
        }
    }

    public func updateWorkspace(_ workspace: String) async -> ActionResponse {
        await performAndRefresh {
            try await client.updateWorkspace(workspace)
        }
    }

    public func setFavorite(_ workspace: String, favorite: Bool) async -> ActionResponse {
        await performAndRefresh {
            try await client.setFavorite(workspace, favorite: favorite)
        }
    }

    private func performAndRefresh(_ operation: () async throws -> ActionResponse) async -> ActionResponse {
        isLoading = true
        notify()

        let result: ActionResponse
        do {
            result = try await operation()
        } catch let apiError as CxApiError {
            error = apiError
            result = ActionResponse(ok: false, error: apiError.localizedDescription)
        } catch {
            result = ActionResponse(ok: false, error: String(describing: error))
        }

        await refresh()
        return result
    }

    private func notify() {
        onChange?()
    }
}
