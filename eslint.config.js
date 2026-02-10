import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Float32Array: "readonly",
        BigInt: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        Map: "readonly",
        Set: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    ignores: ["node_modules/"],
  },
];
