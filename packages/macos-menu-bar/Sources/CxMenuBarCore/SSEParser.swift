import Foundation

public struct SSEStageEvent: Codable, Equatable, Sendable {
    public var stage: String
    public var message: String?

    public init(stage: String, message: String? = nil) {
        self.stage = stage
        self.message = message
    }
}

public struct SSEParser: Sendable {
    private var buffer = ""
    private let decoder = JSONDecoder()

    public init() {}

    public mutating func append(_ chunk: String) -> [SSEStageEvent] {
        buffer += chunk

        var events: [SSEStageEvent] = []
        while let range = buffer.range(of: "\n\n") {
            let block = String(buffer[..<range.lowerBound])
            buffer = String(buffer[range.upperBound...])
            if let event = Self.parseBlock(block, decoder: decoder) {
                events.append(event)
            }
        }

        return events
    }

    public mutating func finish() -> [SSEStageEvent] {
        let trailing = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        buffer = ""
        guard !trailing.isEmpty else { return [] }
        return Self.parseBlock(trailing, decoder: decoder).map { [$0] } ?? []
    }

    public static func outcome(for chunks: [String]) -> ActionResponse {
        var parser = SSEParser()
        var sawDone = false
        var lastError: String?

        for chunk in chunks {
            for event in parser.append(chunk) {
                if event.stage == "error" {
                    lastError = event.message ?? "Unknown error"
                }
                if event.stage == "done" {
                    sawDone = true
                }
            }
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

    private static func parseBlock(_ block: String, decoder: JSONDecoder) -> SSEStageEvent? {
        let data = block
            .split(separator: "\n", omittingEmptySubsequences: false)
            .compactMap { line -> String? in
                let trimmed = line.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
                guard trimmed.hasPrefix("data:") else { return nil }
                return String(trimmed.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces)
            }
            .joined(separator: "\n")

        guard !data.isEmpty, let payload = data.data(using: .utf8) else {
            return nil
        }

        return try? decoder.decode(SSEStageEvent.self, from: payload)
    }
}
