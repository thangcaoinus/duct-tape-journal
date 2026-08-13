// Flat ESLint config — deliberately minimal. It catches real mistakes (unused
// vars, bad hooks usage, obvious bugs) and stays out of the way on style, which
// Prettier owns. Not a pedantic gate; a light safety net.
import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "diary/**",
      "diary.sample/**",
      "diary.demo/**",
    ],
  },

  // Frontend (React, browser).
  {
    files: ["src/**/*.{js,jsx}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // React 17+ automatic JSX runtime
      "react/prop-types": "off", // plain JS, no prop-types by choice
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Cosmetic JSX apostrophe escaping — a warning, not a blocker.
      "react/no-unescaped-entities": "warn",
      // react-hooks v7's opinionated take on effect-driven setState. Several of
      // this app's effects legitimately sync loaded/measured state that way (the
      // pagination measure pass, the concepts cache subscription). Kept as a
      // warning so it's visible without failing CI on intentional, working code.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Backend + scripts (Node, ESM).
  {
    files: ["server/**/*.js", "scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_|^(req|res|next)$" }],
    },
  },

  // Tests (Node + Vitest globals).
  {
    files: ["server/__tests__/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.vitest },
    },
  },

  prettier, // turn off stylistic rules Prettier handles
];
