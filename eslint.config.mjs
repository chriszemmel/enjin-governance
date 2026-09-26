import nextBaseConfig from "eslint-config-next"
import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

const config = [
  {
    ignores: [
      ".next/**",
      ".vercel/**",
      "node_modules/**",
      "components/ui/**",
      "hooks/use-toast.ts",
      "hooks/use-mobile.ts",
      "next-env.d.ts",
      "public/**",
      "coverage/**",
      "dist/**",
      // Playwright output (reports can hold the trace viewer's scripts).
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      // Local tool state, e.g. git worktrees of this repo.
      ".claude/**",
    ],
  },
  ...nextBaseConfig,
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "warn",
      // Disabled: this rule from eslint-plugin-react-hooks v7 flags the
      // canonical next-themes mount-detection pattern as well as other
      // legitimate "sync with browser API on mount" effects. The cost of
      // the false positives outweighs the value.
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
]

export default config
