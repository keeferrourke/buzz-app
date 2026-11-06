// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  BUZZ_SCHEME,
  type ColorScheme,
  createTerminalThemePreference,
  listSchemes,
  MAX_IMPORTED_SCHEMES,
  parseColorScheme,
  parseColorSchemeJson,
  resolveTerminalTheme,
  TERMINAL_THEME_KEY,
  xtermTheme,
} from "./theme-preference";

const scheme = (name: string, background = "#101010"): ColorScheme =>
  parseColorScheme({
    name,
    background,
    foreground: "#eeeeee",
    black: "#000",
    red: "#f00",
    green: "#0f0",
    yellow: "#ff0",
    blue: "#00f",
    purple: "#f0f",
    cyan: "#0ff",
    white: "#fff",
    brightBlack: "#888",
    brightRed: "#f88",
    brightGreen: "#8f8",
    brightYellow: "#ff8",
    brightBlue: "#88f",
    brightPurple: "#f8f",
    brightCyan: "#8ff",
    brightWhite: "#fff",
  });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("parses one Windows Terminal scheme and maps it to xterm", () => {
  const parsed = scheme(" One Half ");
  expect(parsed.name).toBe("One Half");
  expect(parsed.red).toBe("#ff0000");
  expect(xtermTheme(parsed)).toMatchObject({
    magenta: "#ff00ff",
    brightMagenta: "#ff88ff",
    cursor: "#eeeeee",
    selectionBackground: "#eeeeee40",
  });
  expect(() => parseColorSchemeJson("{broken")).toThrow("valid JSON");
  expect(() => parseColorSchemeJson("[]")).toThrow("single color scheme");
  expect(() => parseColorScheme({ ...parsed, name: "" })).toThrow("name");
  expect(() => parseColorScheme({ ...parsed, red: "red" })).toThrow("“red”");
  expect(() => parseColorSchemeJson(" ".repeat(64 * 1024 + 1))).toThrow(
    "too large",
  );
});

it("collapses Light/Dark pairs and resolves appearance with a Buzz fallback", () => {
  const light = scheme("Paper Light", "#ffffff");
  const dark = scheme("Paper Dark", "#000000");
  const lone = scheme("Lone Dark");
  const names = listSchemes([lone, dark, light]).map(({ name }) => name);
  expect(names).toEqual([BUZZ_SCHEME, "Selenized", "Lone Dark", "Paper"]);
  const imported = [light, dark];
  const resolve = (
    appearance: "system" | "light" | "dark",
    name: string,
    mode: "light" | "dark",
  ) => resolveTerminalTheme({ appearance, scheme: name, imported }, mode);
  expect(resolve("system", "Paper", "dark").scheme).toBe(dark);
  expect(resolve("system", "Paper", "light").scheme).toBe(light);
  expect(resolve("light", "Paper", "dark").scheme).toBe(light);
  expect(resolve("dark", "Selenized", "light").scheme?.name).toBe(
    "Selenized Dark",
  );
  expect(resolve("dark", "Gone", "light")).toMatchObject({
    entry: { name: BUZZ_SCHEME },
    mode: "dark",
    scheme: null,
  });
});

it("imports, selects, persists and removes schemes, including both of a pair", () => {
  const colors = createTerminalThemePreference();
  colors.setAppearance("dark");
  colors.importScheme(scheme("Paper Light"));
  expect(colors.snapshot().scheme).toBe("Paper Light");
  colors.importScheme(scheme("Paper Dark"));
  expect(colors.snapshot().scheme).toBe("Paper");
  for (const name of ["selenized dark", "Selenized", "Buzz Light"])
    expect(() => colors.importScheme(scheme(name))).toThrow("built-in");

  const restored = createTerminalThemePreference();
  expect(restored.snapshot()).toMatchObject({
    appearance: "dark",
    scheme: "Paper",
    imported: [{ name: "Paper Light" }, { name: "Paper Dark" }],
  });
  restored.remove("Paper");
  expect(restored.snapshot()).toMatchObject({
    scheme: BUZZ_SCHEME,
    imported: [],
  });
  restored.setAppearance("system");
  expect(localStorage.getItem(TERMINAL_THEME_KEY)).toBeNull();
  colors.dispose();
  restored.dispose();
});

it("drops damaged saved imports, caps imports and syncs other windows", () => {
  localStorage.setItem(
    TERMINAL_THEME_KEY,
    JSON.stringify({
      appearance: "sideways",
      scheme: "Kept",
      imported: [scheme("Kept"), { name: "Broken" }, scheme("Buzz")],
    }),
  );
  const colors = createTerminalThemePreference();
  expect(colors.snapshot()).toMatchObject({
    appearance: "system",
    scheme: "Kept",
    imported: [{ name: "Kept" }],
  });
  for (let i = 1; i < MAX_IMPORTED_SCHEMES; i++)
    colors.importScheme(scheme(`Extra ${i}`));
  expect(() => colors.importScheme(scheme("One too many"))).toThrow(
    "Remove one first",
  );
  colors.importScheme(scheme("Kept", "#202020"));
  expect(colors.snapshot().imported).toHaveLength(MAX_IMPORTED_SCHEMES);

  localStorage.setItem(
    TERMINAL_THEME_KEY,
    JSON.stringify({ appearance: "light", scheme: "Selenized", imported: [] }),
  );
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: TERMINAL_THEME_KEY,
      storageArea: localStorage,
    }),
  );
  expect(colors.snapshot()).toMatchObject({
    appearance: "light",
    scheme: "Selenized",
  });
  colors.dispose();
});

it("keeps the active choice when storage fails and retries the save", () => {
  const colors = createTerminalThemePreference();
  const setItem = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  colors.setScheme("Selenized");
  expect(colors.snapshot()).toMatchObject({
    scheme: "Selenized",
    error: expect.stringContaining("could not be saved"),
  });
  setItem.mockRestore();
  colors.retry();
  expect(colors.snapshot().error).toBeNull();
  expect(
    JSON.parse(localStorage.getItem(TERMINAL_THEME_KEY) ?? "null"),
  ).toEqual({ appearance: "system", scheme: "Selenized", imported: [] });
  colors.dispose();
});
