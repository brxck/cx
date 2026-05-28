import Foundation

public enum CxApiError: Error, Equatable, LocalizedError, Sendable {
    case unreachable(String)
    case unauthorized
    case httpStatus(Int, String)
    case invalidResponse
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .unreachable:
            return "cx serve is not reachable. Run `cx serve` and try again."
        case .unauthorized:
            return "cx serve rejected the API key at \(CxApiClient.keyPath). Restart `cx serve` to regenerate it, or check the file's contents."
        case let .httpStatus(_, detail):
            return detail
        case .invalidResponse:
            return "cx serve returned an invalid response."
        case let .decoding(detail):
            return detail
        }
    }

    public var menuTitle: String {
        switch self {
        case .unauthorized:
            return "Unauthorized"
        default:
            return "cx serve unreachable"
        }
    }
}

public final class CxApiClient {
    public static let keyPath = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent(".config/cx/serve-key")
        .path

    private let host: String
    private let port: Int
    private let session: URLSession
    private var cachedKey: String?

    public init(host: String = "localhost", port: Int = 7373, session: URLSession = .shared) {
        self.host = host
        self.port = port
        self.session = session
    }

    public func getStatus() async throws -> StatusResponse {
        try await request("/api/status")
    }

    @discardableResult
    public func activateLayout(_ layout: String) async throws -> ActivateLayoutResponse {
        try await request(
            "/api/activate",
            method: "POST",
            body: ["layout": layout]
        )
    }

    public func startWorkspace(_ workspace: String) async throws -> ActionResponse {
        try await postAction("/api/start", body: ["workspace": workspace])
    }

    public func stopWorkspace(_ workspace: String) async throws -> ActionResponse {
        try await postAction("/api/stop", body: ["workspace": workspace])
    }

    public func restartWorkspace(_ workspace: String) async throws -> ActionResponse {
        try await streamAction("/api/restart", body: ["workspace": workspace])
    }

    public func updateWorkspace(_ workspace: String) async throws -> ActionResponse {
        try await streamAction("/api/update", body: ["workspace": workspace])
    }

    public func reloadApiKey() {
        cachedKey = nil
    }

    private func readApiKey() -> String {
        if let cachedKey {
            return cachedKey
        }

        let key = (try? String(contentsOfFile: Self.keyPath, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)) ?? ""
        cachedKey = key
        return key
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: String]? = nil
    ) async throws -> T {
        let request = try makeRequest(path, method: method, body: body)
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw CxApiError.unreachable(String(describing: error))
        }

        try validate(response: response, data: data)

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw CxApiError.decoding(error.localizedDescription)
        }
    }

    private func postAction(_ path: String, body: [String: String]) async throws -> ActionResponse {
        let request = try makeRequest(path, method: "POST", body: body)
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw CxApiError.unreachable(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw CxApiError.invalidResponse
        }
        if http.statusCode == 401 {
            throw CxApiError.unauthorized
        }

        if let action = try? JSONDecoder().decode(ActionResponse.self, from: data) {
            return action
        }

        if !(200..<300).contains(http.statusCode) {
            throw CxApiError.httpStatus(http.statusCode, httpErrorDetail(from: data, response: http))
        }

        return ActionResponse(ok: true)
    }

    private func streamAction(_ path: String, body: [String: String]) async throws -> ActionResponse {
        let request = try makeRequest(path, method: "POST", body: body)
        let bytes: URLSession.AsyncBytes
        let response: URLResponse

        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            throw CxApiError.unreachable(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw CxApiError.invalidResponse
        }
        if http.statusCode == 401 {
            throw CxApiError.unauthorized
        }
        if !(200..<300).contains(http.statusCode) {
            throw CxApiError.httpStatus(http.statusCode, "\(http.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: http.statusCode))")
        }

        var parser = SSEParser()
        var sawDone = false
        var lastError: String?

        do {
            for try await line in bytes.lines {
                for event in parser.append(line + "\n") {
                    if event.stage == "error" {
                        lastError = event.message ?? "Unknown error"
                    }
                    if event.stage == "done" {
                        sawDone = true
                    }
                }

                if lastError != nil || sawDone {
                    break
                }
            }
        } catch {
            throw CxApiError.unreachable(String(describing: error))
        }

        for event in parser.finish() {
            if event.stage == "error" {
                lastError = event.message ?? "Unknown error"
            }
            if event.stage == "done" {
                sawDone = true
            }
        }

        if let lastError {
            return ActionResponse(ok: false, error: lastError)
        }
        return ActionResponse(ok: sawDone)
    }

    private func makeRequest(
        _ path: String,
        method: String,
        body: [String: String]?
    ) throws -> URLRequest {
        guard let url = URL(string: "http://\(host):\(port)\(path)") else {
            throw CxApiError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method

        let key = readApiKey()
        if !key.isEmpty {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw CxApiError.invalidResponse
        }
        if http.statusCode == 401 {
            throw CxApiError.unauthorized
        }
        if !(200..<300).contains(http.statusCode) {
            throw CxApiError.httpStatus(http.statusCode, httpErrorDetail(from: data, response: http))
        }
    }

    private func httpErrorDetail(from data: Data, response: HTTPURLResponse) -> String {
        if let decoded = try? JSONDecoder().decode(ErrorResponse.self, from: data),
           let error = decoded.error,
           !error.isEmpty {
            return error
        }

        let reason = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        return "\(response.statusCode) \(reason)"
    }
}
