/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** cx serve host - Host where `cx serve` is listening. */
  "host": string,
  /** cx serve port - Port where `cx serve` is listening. */
  "port": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `list-layouts` command */
  export type ListLayouts = ExtensionPreferences & {}
  /** Preferences accessible in the `list-workspaces` command */
  export type ListWorkspaces = ExtensionPreferences & {}
  /** Preferences accessible in the `menu-bar-status` command */
  export type MenuBarStatus = ExtensionPreferences & {}
  /** Preferences accessible in the `up-from-template` command */
  export type UpFromTemplate = ExtensionPreferences & {}
  /** Preferences accessible in the `find-layout` command */
  export type FindLayout = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `list-layouts` command */
  export type ListLayouts = {}
  /** Arguments passed to the `list-workspaces` command */
  export type ListWorkspaces = {}
  /** Arguments passed to the `menu-bar-status` command */
  export type MenuBarStatus = {}
  /** Arguments passed to the `up-from-template` command */
  export type UpFromTemplate = {}
  /** Arguments passed to the `find-layout` command */
  export type FindLayout = {
  /** layout name or branch */
  "query": string
}
}

