import XCTest
@testable import CxMenuBarCore

final class CxMenuBarCoreTests: XCTestCase {
    func testDecodesStatusResponse() throws {
        let status = try JSONDecoder().decode(StatusResponse.self, from: sampleStatusJSON)

        XCTAssertEqual(status.workspaces.count, 2)
        XCTAssertEqual(status.workspaces[0].name, "alpha")
        XCTAssertEqual(status.workspaces[0].apps?.first?.label, "App One")
        XCTAssertEqual(status.workspaces[0].apps?.first?.icon, "https://coder.example/icon.png")
        XCTAssertEqual(status.layouts.first?.cmuxId, "cmux-alpha-old")
        XCTAssertEqual(status.layouts.first?.type, "ephemeral")
    }

    func testGroupsLayoutsByWorkspace() throws {
        let status = try JSONDecoder().decode(StatusResponse.self, from: sampleStatusJSON)
        let grouped = status.layoutsByWorkspace

        XCTAssertEqual(grouped["alpha"]?.map(\.name), ["alpha-newer", "alpha-older"])
        XCTAssertEqual(grouped["beta"]?.map(\.name), ["beta-layout"])
    }

    func testPicksActiveLayoutByNewestActiveAt() throws {
        let status = try JSONDecoder().decode(StatusResponse.self, from: sampleStatusJSON)

        XCTAssertEqual(status.activeLayout?.name, "alpha-newer")
        XCTAssertEqual(status.activeLayout(for: "alpha")?.name, "alpha-newer")
        XCTAssertEqual(status.activeLayout(for: "missing")?.name, nil)
    }

    func testStatusBarStateDerivation() {
        let empty = StatusResponse(workspaces: [], layouts: [])
        XCTAssertEqual(empty.statusBarState.title, "0")
        XCTAssertEqual(empty.statusBarState.indicator, .inactive)

        let healthy = StatusResponse(
            workspaces: [
                workspace(name: "alpha", status: "running", healthy: true)
            ],
            layouts: []
        )
        XCTAssertEqual(healthy.statusBarState.title, "1")
        XCTAssertEqual(healthy.statusBarState.tooltip, "cx · 1 running")
        XCTAssertEqual(healthy.statusBarState.indicator, .healthy)

        let unhealthy = StatusResponse(
            workspaces: [
                workspace(name: "alpha", status: "running", healthy: true),
                workspace(name: "beta", status: "running", healthy: false),
                workspace(name: "gamma", status: "stopped", healthy: false),
            ],
            layouts: []
        )
        XCTAssertEqual(unhealthy.statusBarState.title, "2")
        XCTAssertEqual(unhealthy.statusBarState.unhealthyCount, 1)
        XCTAssertEqual(unhealthy.statusBarState.indicator, .healthy)
    }

    func testWorkspaceSortingUsesNewestTimestampFirst() {
        let status = StatusResponse(
            workspaces: [
                workspace(name: "alpha", status: "running", healthy: true, lastBuildAt: "2026-05-28T10:00:00.000Z"),
                workspace(name: "bravo", status: "running", healthy: true, lastBuildAt: "2026-05-28T12:00:00.000Z"),
                workspace(name: "charlie", status: "stopped", healthy: true, lastBuildAt: "2026-05-28T11:00:00.000Z"),
                workspace(name: "zulu", status: "stopped", healthy: true, lastBuildAt: "2026-05-28T09:00:00.000Z"),
            ],
            layouts: []
        )

        XCTAssertEqual(status.sortedWorkspaces.map(\.name), ["bravo", "alpha", "charlie", "zulu"])
        XCTAssertEqual(status.runningWorkspaces.map(\.name), ["bravo", "alpha"])
    }

    func testWorkspaceAppsSortByLabel() {
        let ws = WorkspaceInfo(
            name: "alpha",
            status: "running",
            healthy: true,
            outdated: false,
            buildAge: "1m ago",
            lastBuildAt: "2026-05-28T12:00:00.000Z",
            templateName: "owner-dev",
            sessions: [],
            apps: [
                WorkspaceApp(slug: "z", label: "Zed", url: "https://zed.example"),
                WorkspaceApp(slug: "a", label: "Alpha", url: "https://alpha.example"),
                WorkspaceApp(slug: "m", label: "Mid", url: "https://mid.example"),
            ]
        )

        XCTAssertEqual(ws.sortedApps.map(\.label), ["Alpha", "Mid", "Zed"])
    }

    func testSSEParsingDoneAcrossChunks() {
        let outcome = SSEParser.outcome(for: [
            "data: {\"stage\":\"restart",
            "ing\",\"message\":\"Restarting alpha\"}\n\n",
            "data: {\"stage\":\"done\",\"message\":\"Workspace restarted\"}\n\n",
        ])

        XCTAssertEqual(outcome, ActionResponse(ok: true))
    }

    func testSSEParsingErrorWins() {
        let outcome = SSEParser.outcome(for: [
            "data: {\"stage\":\"error\",\"message\":\"Boom\"}\n\n",
            "data: {\"stage\":\"done\",\"message\":\"Done\"}\n\n",
        ])

        XCTAssertEqual(outcome, ActionResponse(ok: false, error: "Boom"))
    }

    private func workspace(
        name: String,
        status: String,
        healthy: Bool,
        lastBuildAt: String = "2026-05-28T12:00:00.000Z"
    ) -> WorkspaceInfo {
        WorkspaceInfo(
            name: name,
            status: status,
            healthy: healthy,
            outdated: false,
            buildAge: "1m ago",
            lastBuildAt: lastBuildAt,
            templateName: "owner-dev",
            sessions: []
        )
    }
}

private let sampleStatusJSON = """
{
  "workspaces": [
    {
      "name": "alpha",
      "status": "running",
      "healthy": true,
      "outdated": false,
      "buildAge": "2m ago",
      "lastBuildAt": "2026-05-28T12:00:00.000Z",
      "templateName": "owner-dev",
      "sessions": ["api"],
      "dashboard": "https://coder.example/@me/alpha",
      "terminal": "https://coder.example/@me/alpha.main/terminal",
      "apps": [
        {
          "slug": "app-one",
          "label": "App One",
          "url": "https://app-one.example",
          "icon": "https://coder.example/icon.png"
        }
      ]
    },
    {
      "name": "beta",
      "status": "stopped",
      "healthy": false,
      "outdated": true,
      "buildAge": "1h ago",
      "lastBuildAt": "2026-05-28T11:00:00.000Z",
      "templateName": "owner-dev",
      "sessions": []
    }
  ],
  "layouts": [
    {
      "name": "alpha-older",
      "cmuxId": "cmux-alpha-old",
      "coderWs": "alpha",
      "template": "base",
      "type": "ephemeral",
      "branch": "main",
      "path": "/repo",
      "activeAt": "2026-05-28T10:00:00.000Z",
      "sessions": ["api"]
    },
    {
      "name": "alpha-newer",
      "cmuxId": "cmux-alpha",
      "coderWs": "alpha",
      "template": "base",
      "type": "ephemeral",
      "branch": "main",
      "path": "/repo",
      "activeAt": "2026-05-28T12:30:00.000Z",
      "sessions": ["web"]
    },
    {
      "name": "beta-layout",
      "cmuxId": "cmux-beta",
      "coderWs": "beta",
      "template": null,
      "type": "persistent",
      "branch": null,
      "path": null,
      "activeAt": "2026-05-28T09:00:00.000Z",
      "sessions": []
    }
  ]
}
""".data(using: .utf8)!
