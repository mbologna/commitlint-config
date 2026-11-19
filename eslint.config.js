import js from "@eslint/js";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  prettier,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    // commitlint passes a rule (context, when, value): a rule may ignore `when`
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  { ignores: ["node_modules/**"] },
];
