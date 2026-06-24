import type { ScanResult, FileContent } from "../types";

const KNOWN_DEPRECATED_NPM: Record<string, string> = {
  "left-pad": "Deprecated. Consider using String.prototype.padStart() or a modern alternative.",
  request: "Deprecated as of Feb 2020. Use node-fetch, axios, or got instead.",
  "gulp-util": "Deprecated. Use individual gulp plugins instead.",
  "har-validator": "Deprecated. No longer needed by modern tooling.",
  "npm-conf": "Deprecated. Use npm's built-in config API.",
  "resolve-url": "Deprecated. Use resolve-url-loader or native URL resolution.",
  urix: "Deprecated. No longer maintained.",
  bower: "Deprecated. Use npm, yarn, or pnpm instead.",
  grunt: "Deprecated in favor of npm scripts, Gulp, or modern build tools.",
  jade: "Renamed to 'pug'. Use pug instead.",
  "node-uuid": "Deprecated. Use the 'uuid' package instead.",
  "react-proptypes": "Deprecated. Use the 'prop-types' package instead.",
  "create-react-class": "Deprecated. Use modern class or functional components.",
  "react-dom-factories": "Deprecated. Use JSX or createElement directly.",
  moment: "Considered legacy. Use date-fns, dayjs, or luxon for tree-shakable alternatives.",
  faker: "Renamed to '@faker-js/faker'. Update your dependency.",
  colors: "Supply chain incident in 2022 (v1.4.2+ had breaking changes). Pin carefully.",
  "react-addons-transition-group": "Deprecated. Use react-transition-group instead.",
  "react-addons-css-transition-group": "Deprecated. Use react-transition-group instead.",
  "react-addons-linked-state-mixin": "Deprecated. Use local state management instead.",
  "react-addons-pure-render-mixin": "Deprecated. Use PureComponent or React.memo.",
  "react-addons-update": "Deprecated. Use immutability helpers like immer.",
  "react-addons-clone-with-props": "Deprecated. Clone elements directly instead.",
  "react-addons-create-fragment": "Deprecated. Use fragments (<>...</>) instead.",
  "react-addons-shallow-compare": "Deprecated. Use React.PureComponent or React.memo.",
  "react-addons-test-utils": "Deprecated. Use @testing-library/react instead.",
  "react-timer-mixin": "Deprecated. Use native timers directly.",
  "react-native-drawer-layout": "Deprecated. Use @react-navigation/drawer.",
  "react-native-linear-gradient": "Deprecated. Use expo-linear-gradient or react-native-svg.",
  "react-native-vector-icons": "Deprecated. Use @expo/vector-icons or react-native-svg-icon.",
  "react-native-maps": "Deprecated. Use @react-navigation/native or expo-maps.",
  "react-native-screens": "Deprecated. Use @react-navigation/native-stack.",
  "react-native-safe-area-context": "Deprecated. Use react-native's built-in SafeAreaView.",
  "react-native-gesture-handler": "Deprecated. Use react-native's built-in gesture system.",
  "react-native-reanimated": "Deprecated. Use react-native's built-in animated API.",
  "react-native-svg": "Deprecated. Use expo-svg or react-native-svg-transformer.",
  "react-native-webview": "Deprecated. Use react-native's built-in WebView.",
  "react-native-firebase": "Deprecated. Use @react-native-firebase/* modular packages.",
  "react-native-device-info": "Deprecated. Use expo-device or react-native's built-in APIs.",
  "react-native-iap": "Deprecated. Use expo-in-app-purchases.",
  "react-native-pdf": "Deprecated. Use react-native-pdf-lib or expo-print.",
  "react-native-fs": "Deprecated. Use expo-file-system or react-native-blob-util.",
  "react-native-camera": "Deprecated. Use react-native-vision-camera or expo-camera.",
  "react-native-image-picker": "Deprecated. Use react-native-image-crop-picker or expo-image-picker.",
  "react-native-push-notification": "Deprecated. Use @notifee/react-native or expo-notifications.",
  "react-native-splash-screen": "Deprecated. Use expo-splash-screen.",
  "react-native-encrypted-storage": "Deprecated. Use expo-secure-store.",
  "react-native-localization": "Deprecated. Use i18next or expo-localization.",
  "react-native-onesignal": "Deprecated. Use onesignal/react-native-onesignal.",
};

const KNOWN_MALICIOUS_NPM: Record<string, string> = {
  "crossenv": "Typosquatting of 'cross-env'. Do not install.",
  "http-proxy-": "Typosquatting of 'http-proxy'. Do not install.",
  "babel-lo": "Typosquatting of 'babel-loader'. Do not install.",
  "babel-node": "Typosquatting of @babel/node. Do not install.",
  "grunt-radic": "Typosquatting of 'grunt'. Do not install.",
  "gul-p": "Typosquatting of 'gulp'. Do not install.",
  "lodahs": "Typosquatting of 'lodash'. Do not install.",
  "lodash-": "Typosquatting of 'lodash'. Do not install.",
  "reques": "Typosquatting of 'request'. Do not install.",
  "sequelize": "Typosquatting of 'sequelize' (note: correct is 'sequelize'). Do not install.",
  "babel-eslint": "Typosquatting of 'babel-eslint'. The correct package is babel-eslint.",
  "eslint-config-airbnb": "Typosquatting of 'eslint-config-airbnb'. Do not install.",
  "typescript": "Typosquatting of 'typescript' with extra 's'. Do not install.",
  "teaspoon": "Typosquatting that installs malware. Do not install.",
  "ssl-express": "Typosquatting that installs malware. Do not install.",
  "opencv": "Typosquatting of 'opencv' that installs malware. Do not install.",
  "python-mysql": "Typosquatting of 'mysql-connector-python'. Do not install.",
  "python3": "Typosquatting that installs malware. Do not install.",
  "lib-http": "Typosquatting of 'lib-http'. Do not install.",
};

const POPULAR_NPM_PACKAGES = new Set([
  "react", "react-dom", "vue", "angular", "svelte", "jquery", "lodash", "axios",
  "express", "next", "nuxt", "gatsby", "webpack", "vite", "rollup", "parcel",
  "babel", "typescript", "eslint", "prettier", "jest", "mocha", "chai", "sinon",
  "moment", "dayjs", "date-fns", "luxon", "uuid", "nanoid", "dotenv", "cross-env",
  "http-proxy", "http-proxy-middleware", "cors", "helmet", "body-parser", "cookie-parser",
  "passport", "jsonwebtoken", "bcrypt", "sharp", "multer", "socket.io", "ws",
  "graphql", "apollo", "prisma", "typeorm", "sequelize", "mongoose", "redis",
  "ioredis", "bull", "amqplib", "kafka", "nodemailer", "handlebars", "pug", "ejs",
  "tailwindcss", "bootstrap", "material-ui", "@mui", "chakra-ui", "antd", "semantic-ui",
  "redux", "zustand", "pinia", "mobx", "recoil", "jotai", "valtio",
  "react-router", "react-query", "swr", "react-hook-form", "formik", "yup",
  "zod", "joi", "class-validator", "rxjs", "immer", "ramda", "fp-ts",
  "lodash-es", "async", "bluebird", "p-map", "glob", "rimraf", "mkdirp",
  "commander", "yargs", "inquirer", "ora", "chalk", "colorette", "picocolors",
  "fastify", "hapi", "koa", "sails", "meteor", "strapi", "keystone",
  "nx", "lerna", "turbo", "changesets", "semantic-release", "husky", "lint-staged",
  "@faker-js/faker", "faker", "chance", "casual",
]);

const KNOWN_DEPRECATED_CRATES: Record<string, string> = {
  "rustc-serialize": "Deprecated. Use serde instead.",
  "advapi32-sys": "Deprecated. Use winapi or windows crate.",
  "kernel32-sys": "Deprecated. Use winapi or windows crate.",
  "user32-sys": "Deprecated. Use winapi or windows crate.",
  "gdi32-sys": "Deprecated. Use winapi or windows crate.",
  "ole32-sys": "Deprecated. Use winapi or windows crate.",
  "shell32-sys": "Deprecated. Use winapi or windows crate.",
  "oleaut32-sys": "Deprecated. Use winapi or windows crate.",
  "comctl32-sys": "Deprecated. Use winapi or windows crate.",
  "ws2_32-sys": "Deprecated. Use winapi or windows crate.",
  "env_logger": "Deprecated. Use log crate with a different sink or tracing.",
  "old-time": "Deprecated. Use chrono or time crate.",
  "time": "Old version (0.1-0.2) deprecated. Use time 0.3+ or chrono.",
  "dbghelp-sys": "Deprecated. Use winapi or backtrace crate.",
  "uuid": "Old version (0.7-) merged into uuid 1.0. Use uuid 1.0+.",
  "bitflags": "Old version (0.x). Use bitflags 1.0+ or 2.0+.",
};

const SUSPICIOUS_SCRIPTS = ["preinstall", "postinstall", "preuninstall", "postuninstall"];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function checkTyposquat(name: string): string | null {
  const normalized = name.toLowerCase().replace(/^@[^/]+\//, "");
  const close: Array<{ pkg: string; dist: number }> = [];
  for (const popular of POPULAR_NPM_PACKAGES) {
    const dist = levenshtein(normalized, popular.toLowerCase());
    if (dist > 0 && dist <= 2 && normalized.length >= 4) {
      close.push({ pkg: popular, dist });
    }
  }
  if (close.length > 0) {
    close.sort((a, b) => a.dist - b.dist);
    return `"${name}" is suspiciously similar to "${close[0].pkg}" (edit distance: ${close[0].dist}). Verify this is the intended package.`;
  }
  return null;
}

export function checkDependencies(files: FileContent[]): ScanResult[] {
  const results: ScanResult[] = [];

  for (const file of files) {
    if (file.path.endsWith("package.json")) {
      results.push(...checkPackageJson(file));
    } else if (file.path.endsWith("Cargo.toml")) {
      results.push(...checkCargoToml(file));
    }
  }

  return results;
}

function checkPackageJson(file: FileContent): ScanResult[] {
  const results: ScanResult[] = [];
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(file.content);
  } catch {
    results.push({
      file: file.path,
      type: "dependency",
      severity: "error",
      message: "package.json is not valid JSON",
      suggestion: "Fix the JSON syntax in package.json.",
    });
    return results;
  }

  const allDeps: Record<string, string> = {};

  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    const deps = parsed[section];
    if (deps && typeof deps === "object") {
      for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
        allDeps[name] = String(version);
      }
    }
  }

  for (const [name, version] of Object.entries(allDeps)) {
    const deprecatedMsg = KNOWN_DEPRECATED_NPM[name];
    if (deprecatedMsg) {
      results.push({
        file: file.path,
        type: "dependency",
        severity: "warning",
        message: `Deprecated package "${name}" (${version}): ${deprecatedMsg}`,
        suggestion: `Replace "${name}" with the recommended alternative.`,
      });
    }

    const maliciousMsg = KNOWN_MALICIOUS_NPM[name];
    if (maliciousMsg) {
      results.push({
        file: file.path,
        type: "dependency",
        severity: "error",
        message: `Potentially malicious package "${name}": ${maliciousMsg}`,
        suggestion: `Remove "${name}" immediately and verify your lockfile.`,
      });
    }

    const typosquatMsg = checkTyposquat(name);
    if (typosquatMsg) {
      results.push({
        file: file.path,
        type: "dependency",
        severity: "error",
        message: typosquatMsg,
        suggestion: `Double-check the package name. You may have meant a different package.`,
      });
    }

    if (/^[~^]/.test(version)) {
      results.push({
        file: file.path,
        type: "dependency",
        severity: "info",
        message: `Package "${name}" has an unpinned version range "${version}". Consider pinning for reproducible builds.`,
        suggestion: `Replace "${version}" with an exact version like "1.2.3".`,
      });
    }
  }

  const scripts = parsed["scripts"];
  if (scripts && typeof scripts === "object") {
    for (const scriptName of Object.keys(scripts as Record<string, unknown>)) {
      if (SUSPICIOUS_SCRIPTS.includes(scriptName)) {
        results.push({
          file: file.path,
          type: "dependency",
          severity: "warning",
          message: `Package.json has a "${scriptName}" script hook. Install scripts are a common vector for supply-chain attacks.`,
          suggestion: `Remove the "${scriptName}" script unless it is absolutely necessary.`,
        });
      }
    }
  }

  return results;
}

function checkCargoToml(file: FileContent): ScanResult[] {
  const results: ScanResult[] = [];
  const lines = file.content.split("\n");
  let inDeps = false;
  let inDevDeps = false;
  let inBuildDeps = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("[dependencies]")) {
      inDeps = true; inDevDeps = false; inBuildDeps = false;
      continue;
    }
    if (line.trim().startsWith("[dev-dependencies]")) {
      inDeps = false; inDevDeps = true; inBuildDeps = false;
      continue;
    }
    if (line.trim().startsWith("[build-dependencies]")) {
      inDeps = false; inDevDeps = false; inBuildDeps = true;
      continue;
    }
    if (line.trim().startsWith("[")) {
      inDeps = false; inDevDeps = false; inBuildDeps = false;
    }

    if (!inDeps && !inDevDeps && !inBuildDeps) continue;

    const depMatch = line.trim().match(/^(\w[\w-]*)\s*=/);
    if (!depMatch) continue;

    const depName = depMatch[1];
    const rawVersion = line.includes("=") ? line.split("=")[1].trim() : "";
    const versionStr = rawVersion.replace(/^"/, "").replace(/"$/, "");

    if (versionStr === "*") {
      results.push({
        file: file.path,
        type: "dependency",
        severity: "warning",
        message: `Crate "${depName}" uses a wildcard "*" version. This may cause unexpected breaking changes.`,
        line: i + 1,
        suggestion: `Pin "${depName}" to a specific version like "1.2.3".`,
      });
    }

    const deprecatedMsg = KNOWN_DEPRECATED_CRATES[depName];
    if (deprecatedMsg) {
      results.push({
        file: file.path,
        type: "dependency",
        severity: "warning",
        message: `Deprecated crate "${depName}": ${deprecatedMsg}`,
        line: i + 1,
        suggestion: `Replace "${depName}" with the recommended alternative.`,
      });
    }
  }

  return results;
}
