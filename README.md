# swaggerjsontoapimodel

A CLI tool that converts OpenAPI/Swagger v3 JSON documents into TypeScript models. It reads an OpenAPI document from a local file or a remote URL and generates ready-to-use TypeScript interfaces for your API schemas and query parameters.

## Features

- Reads OpenAPI documents from a **local file** or a **remote URL** (`http://` / `https://`).
- Generates one TypeScript interface per schema defined under `components.schemas`.
- Generates query parameter interfaces per endpoint (e.g., `GetUsersOrders`), so you get typed query objects out of the box.
- Full support for `$ref` resolution with automatic imports between generated files.
- Supports `nullable`, `enum` (as union types), arrays (with parentheses around unions), `allOf` / `oneOf` / `anyOf` composition, and `additionalProperties` (mapped to `Record<string, T>`).
- Naming conventions applied automatically: `PascalCase` for types/interfaces and `camelCase` for properties.
- Marks non-required properties as optional (`?`) based on the `required` array.

## Installation

Install as a development dependency:

```bash
npm install -D swaggerjsontoapimodel
```

Or install globally to use it anywhere:

```bash
npm install -g swaggerjsontoapimodel
```

## Usage

```bash
swaggerjsontoapimodel <openapi.json | url> [options]
```

**⚠️ Windows / Git Bash Tip:⚠️**

Git Bash automatically converts root paths (like /api) to Windows paths (like C:\...). To prevent this error, use the MSYS_NO_PATHCONV flag:

```bash
MSYS_NO_PATHCONV=1 npx swaggerjsontoapimodel <openapi.json | url> [options]
```

---

### Options

| Option                    | Description                                                                                    | Default        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| `-o, --output <dir>`      | Output directory. Files are written inside `<dir>/model/`.                                     | `./api-model/` |
| `-bs, --base-path <path>` | Base path to strip from route names when generating query param interfaces (e.g., `/api/v1/`). | _(empty)_      |
| `-h, --help`              | Show help.                                                                                     |                |

### Examples

From a local file:

```bash
swaggerjsontoapimodel openapi.json -o ./generated -bs api/v1/
```

From a URL:

```bash
swaggerjsontoapimodel https://api.example.com/openapi.json -o ./generated -bs /api/v1/
```

With no options at all:

```bash
swaggerjsontoapimodel openapi.json
```

This generates everything into `./api-model/model/`.

> Note: the output directory is wiped and recreated on every run, so treat it as generated code.

## Output structure

Given the command:

```bash
swaggerjsontoapimodel openapi.json -o ./generated
```

The following structure is produced:

```
generated/
└── model/
    ├── interfaces/
    │   ├── user.ts
    │   └── address.ts
    └── query-params/
        └── getusersorders.ts
```

- `model/interfaces/` — one file per schema from `components.schemas`.
- `model/query-params/` — one file per endpoint that declares query parameters, named after the HTTP method and route (with the base path stripped).

## Example of generated code

For a `User` schema referencing an `Address` schema:

```typescript
// model/interfaces/user.ts
import type { Address } from "./address";

export interface User {
  id?: number;
  firstName?: string;
  email?: string;
  address?: Address;
}
```

For a `GET /users/{id}/orders` endpoint with `page` and `limit` query parameters:

```typescript
// model/query-params/getusersorders.ts
export interface GetUsersOrders {
  page?: number;
  limit?: number;
}
```

Enum-only schemas are generated as union types instead of interfaces:

```typescript
export type Status = "active" | "inactive";
```

## License

MIT © [Esteban Fernandez](mailto:efernandezdev@gmail.com)
