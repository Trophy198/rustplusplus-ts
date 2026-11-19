import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["**/*.{js,mjs,cjs,ts}"], languageOptions: { globals: globals.browser } },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      "max-len": ["error", { code: 120 }]
    }
  },
  {
    ignores: [
      "temp", "**/dist/**", "packages/rustplus-ts/src/interfaces/rustplus.ts"
    ]
  },
  tseslint.configs.recommended,
  {
    files: ["tests/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    files: ["tools/rustplus-protocol/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "max-len": ["error", { code: 140, ignoreStrings: true, ignoreTemplateLiterals: true }] }
  },
]);