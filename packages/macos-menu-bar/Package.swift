// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "CxMenuBar",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "CxMenuBarCore", targets: ["CxMenuBarCore"]),
        .executable(name: "cx-menu-bar", targets: ["CxMenuBarApp"]),
    ],
    targets: [
        .target(name: "CxMenuBarCore"),
        .executableTarget(
            name: "CxMenuBarApp",
            dependencies: ["CxMenuBarCore"]
        ),
        .testTarget(
            name: "CxMenuBarCoreTests",
            dependencies: ["CxMenuBarCore"]
        ),
    ]
)
