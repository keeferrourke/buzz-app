import type { ITheme } from "@xterm/xterm";
import type { ColorMode } from "../../shared/theme/service";
import selenizedDark from "./themes/selenized-dark.json";
import selenizedLight from "./themes/selenized-light.json";

/** Terminal-owned, device-local color scheme preference. */
export const TERMINAL_THEME_KEY = "buzz-terminal-theme.v1";
/** The host's own colors; its ANSI colors stay with xterm's palette. */
export const BUZZ_SCHEME = "Buzz";
export const MAX_IMPORTED_SCHEMES = 32;
export const MAX_SCHEME_JSON_BYTES = 64 * 1024;
export type TerminalAppearance = "system" | ColorMode;

// Windows Terminal color scheme keys:
// https://learn.microsoft.com/windows/terminal/customize-settings/color-schemes
const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "purple",
  "cyan",
  "white",
] as const;
const BRIGHT_KEYS = [
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightPurple",
  "brightCyan",
  "brightWhite",
] as const;
const REQUIRED_KEYS = [
  "background",
  "foreground",
  ...ANSI_KEYS,
  ...BRIGHT_KEYS,
] as const;
const OPTIONAL_KEYS = ["cursorColor", "selectionBackground"] as const;
export const PALETTE_KEYS = [...ANSI_KEYS, ...BRIGHT_KEYS] as const;

export type ColorScheme = { readonly name: string } & {
  readonly [K in (typeof REQUIRED_KEYS)[number]]: string;
} & { readonly [K in (typeof OPTIONAL_KEYS)[number]]?: string };

/** One picker choice: a Light/Dark pair, a single scheme, or Buzz (no scheme). */
export type SchemeEntry = {
  readonly name: string;
  readonly light: ColorScheme | null;
  readonly dark: ColorScheme | null;
  readonly imported: boolean;
};

function parseColor(raw: unknown, key: string) {
  if (typeof raw !== "string" || !/^#(?:[0-9a-f]{3}){1,2}$/i.test(raw))
    throw new Error(`“${key}” must be a #RGB or #RRGGBB color.`);
  const hex = raw.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex}`;
}

/** Accept one bare Windows Terminal scheme object, never a full settings file. */
export function parseColorScheme(raw: unknown): ColorScheme {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("Paste a single color scheme object.");
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 64 || /\p{Cc}/u.test(name))
    throw new Error("The scheme needs a name of up to 64 characters.");
  const scheme: Record<string, string> = { name };
  for (const key of REQUIRED_KEYS) scheme[key] = parseColor(value[key], key);
  for (const key of OPTIONAL_KEYS)
    if (value[key] != null) scheme[key] = parseColor(value[key], key);
  return scheme as ColorScheme;
}

export function parseColorSchemeJson(text: string): ColorScheme {
  if (text.length > MAX_SCHEME_JSON_BYTES)
    throw new Error("This scheme is too large to import.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This isn’t valid JSON.");
  }
  return parseColorScheme(raw);
}

const BUNDLED = [selenizedLight, selenizedDark].map(parseColorScheme);
const pairBase = (name: string) => /^(.+) (?:light|dark)$/i.exec(name)?.[1];
const RESERVED = new Set(
  [
    BUZZ_SCHEME,
    ...BUNDLED.map(({ name }) => name),
    ...collapse(BUNDLED, false).map(({ name }) => name),
  ].map((name) => name.toLowerCase()),
);
/** An import must not share a built-in entry's name, alone or as a pair. */
const reserved = (name: string) =>
  [name, pairBase(name)].some(
    (candidate) => candidate && RESERVED.has(candidate.toLowerCase()),
  );

/** Collapse `<Base> Light` / `<Base> Dark` into one entry when both exist. */
function collapse(schemes: readonly ColorScheme[], imported: boolean) {
  // Match pair suffixes case-insensitively, as Nexus does.
  const byName = new Map(
    schemes.map((scheme) => [scheme.name.toLowerCase(), scheme]),
  );
  const entries = new Map<string, SchemeEntry>();
  for (const scheme of schemes) {
    const base = pairBase(scheme.name);
    const key = base?.toLowerCase();
    const light = key && byName.get(`${key} light`);
    const dark = key && byName.get(`${key} dark`);
    if (base && key && light && dark && !byName.has(key))
      entries.set(base, { name: base, light, dark, imported });
    else
      entries.set(scheme.name, {
        name: scheme.name,
        light: scheme,
        dark: scheme,
        imported,
      });
  }
  return [...entries.values()];
}

const BUZZ_ENTRY: SchemeEntry = {
  name: BUZZ_SCHEME,
  light: null,
  dark: null,
  imported: false,
};

export function listSchemes(imported: readonly ColorScheme[]): SchemeEntry[] {
  return [
    BUZZ_ENTRY,
    ...collapse(BUNDLED, false),
    ...collapse(imported, true).sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

/** Pick the active entry and variant; a missing saved scheme falls back to Buzz. */
export function resolveTerminalTheme(
  preference: Pick<TerminalThemeSnapshot, "appearance" | "scheme" | "imported">,
  appMode: ColorMode,
) {
  const entries = listSchemes(preference.imported);
  const entry =
    entries.find(({ name }) => name === preference.scheme) ?? BUZZ_ENTRY;
  const mode =
    preference.appearance === "system" ? appMode : preference.appearance;
  return {
    entry,
    mode,
    scheme: mode === "dark" ? entry.dark : entry.light,
  };
}

export function xtermTheme(scheme: ColorScheme): ITheme {
  return {
    background: scheme.background,
    foreground: scheme.foreground,
    cursor: scheme.cursorColor ?? scheme.foreground,
    cursorAccent: scheme.background,
    selectionBackground: scheme.selectionBackground ?? `${scheme.foreground}40`,
    black: scheme.black,
    red: scheme.red,
    green: scheme.green,
    yellow: scheme.yellow,
    blue: scheme.blue,
    magenta: scheme.purple,
    cyan: scheme.cyan,
    white: scheme.white,
    brightBlack: scheme.brightBlack,
    brightRed: scheme.brightRed,
    brightGreen: scheme.brightGreen,
    brightYellow: scheme.brightYellow,
    brightBlue: scheme.brightBlue,
    brightMagenta: scheme.brightPurple,
    brightCyan: scheme.brightCyan,
    brightWhite: scheme.brightWhite,
  };
}

export type TerminalThemeSnapshot = {
  readonly appearance: TerminalAppearance;
  /** The saved entry name, kept even while no entry matches it. */
  readonly scheme: string;
  readonly imported: readonly ColorScheme[];
  readonly error: string | null;
};

const DEFAULTS = {
  appearance: "system",
  scheme: BUZZ_SCHEME,
  imported: [],
} as const satisfies Omit<TerminalThemeSnapshot, "error">;

function decode(raw: string | null | undefined) {
  if (!raw) return DEFAULTS;
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null)
      value = parsed as Record<string, unknown>;
  } catch {
    /* Invalid saved preferences use defaults. */
  }
  const imported: ColorScheme[] = [];
  for (const item of Array.isArray(value.imported) ? value.imported : []) {
    try {
      const scheme = parseColorScheme(item);
      if (
        imported.length < MAX_IMPORTED_SCHEMES &&
        !reserved(scheme.name) &&
        !imported.some(({ name }) => name === scheme.name)
      )
        imported.push(scheme);
    } catch {
      /* Drop one damaged scheme rather than every import. */
    }
  }
  return {
    appearance:
      value.appearance === "light" || value.appearance === "dark"
        ? value.appearance
        : "system",
    scheme: typeof value.scheme === "string" ? value.scheme : BUZZ_SCHEME,
    imported,
  } satisfies Omit<TerminalThemeSnapshot, "error">;
}

export function createTerminalThemePreference(
  host: Window | undefined = typeof window === "undefined" ? undefined : window,
) {
  let state: TerminalThemeSnapshot = { ...DEFAULTS, error: null };
  let disposed = false;
  let restoreFailed = false;
  const listeners = new Set<() => void>();
  const publish = (next: TerminalThemeSnapshot) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const restore = () => {
    restoreFailed = false;
    try {
      publish({
        ...decode(host?.localStorage.getItem(TERMINAL_THEME_KEY)),
        error: null,
      });
    } catch {
      restoreFailed = true;
      publish({
        ...DEFAULTS,
        error:
          "Your terminal colors could not be restored. The default is active.",
      });
    }
  };
  const commit = (next: Omit<TerminalThemeSnapshot, "error">) => {
    if (disposed) return;
    restoreFailed = false;
    let error: string | null = null;
    try {
      if (!host) throw new Error("No browser storage");
      if (
        next.appearance === DEFAULTS.appearance &&
        next.scheme === DEFAULTS.scheme &&
        next.imported.length === 0
      )
        host.localStorage.removeItem(TERMINAL_THEME_KEY);
      else
        host.localStorage.setItem(
          TERMINAL_THEME_KEY,
          JSON.stringify({
            appearance: next.appearance,
            scheme: next.scheme,
            imported: next.imported,
          }),
        );
    } catch {
      error =
        "Your terminal colors are active, but could not be saved on this device. Try again.";
    }
    publish({ ...next, error });
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TERMINAL_THEME_KEY && event.key !== null) return;
    try {
      if (event.storageArea !== host?.localStorage) return;
    } catch {
      /* restore reports the failure */
    }
    restore();
  };
  restore();
  host?.addEventListener("storage", onStorage);
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAppearance(appearance: TerminalAppearance) {
      commit({ ...state, appearance });
    },
    setScheme(scheme: string) {
      commit({ ...state, scheme });
    },
    /** Add or replace an imported scheme and select its entry. */
    importScheme(scheme: ColorScheme) {
      if (reserved(scheme.name))
        throw new Error(`“${scheme.name}” is a built-in scheme name.`);
      const others = state.imported.filter(({ name }) => name !== scheme.name);
      if (others.length >= MAX_IMPORTED_SCHEMES)
        throw new Error(
          `You can import up to ${MAX_IMPORTED_SCHEMES} schemes. Remove one first.`,
        );
      const imported = [...others, scheme];
      const entry = listSchemes(imported).find(
        ({ light, dark }) => light === scheme || dark === scheme,
      );
      commit({ ...state, imported, scheme: entry?.name ?? scheme.name });
    },
    /** Remove every imported scheme behind an entry, including both of a pair. */
    remove(entryName: string) {
      const entry = listSchemes(state.imported).find(
        ({ name, imported }) => imported && name === entryName,
      );
      if (!entry) return;
      commit({
        ...state,
        imported: state.imported.filter(
          (scheme) => scheme !== entry.light && scheme !== entry.dark,
        ),
        scheme: state.scheme === entryName ? BUZZ_SCHEME : state.scheme,
      });
    },
    retry() {
      if (disposed) return;
      // A failed read must never turn Retry into deletion of unread imports.
      if (restoreFailed) restore();
      else commit(state);
    },
    dispose() {
      disposed = true;
      host?.removeEventListener("storage", onStorage);
      listeners.clear();
    },
  };
}

export type TerminalThemePreference = ReturnType<
  typeof createTerminalThemePreference
>;
