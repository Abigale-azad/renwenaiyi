import type {
  FlowusDatabase,
  FlowusDateValue,
  FlowusList,
  FlowusPage,
  FlowusParent,
  FlowusPropertySchema,
  FlowusPropertyValue,
  FlowusRichText,
  FlowusSearchResult,
  FlowusUser,
} from "@/lib/flowus-types";

export function plainTextFromRichText(richText?: FlowusRichText[]): string {
  if (!Array.isArray(richText)) return "";
  return richText.map((rt) => rt.plain_text ?? rt.text?.content ?? "").join("");
}

export function richTextFromString(content: string): FlowusRichText[] {
  return [
    {
      type: "text",
      text: { content, link: null },
      plain_text: content,
      href: null,
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
    },
  ];
}

export function makeTitleProperty(content: string): FlowusPropertyValue {
  return { type: "title", title: richTextFromString(content) };
}

export function makeRichTextProperty(content: string): FlowusPropertyValue {
  return { type: "rich_text", rich_text: richTextFromString(content) };
}

export function makeSelectProperty(name: string): FlowusPropertyValue {
  return { type: "select", select: { name } };
}

export function makeMultiSelectProperty(names: string[]): FlowusPropertyValue {
  return { type: "multi_select", multi_select: names.map((name) => ({ name })) };
}

export function makeCheckboxProperty(checked: boolean): FlowusPropertyValue {
  return { type: "checkbox", checkbox: checked };
}

export function makeDateProperty(start: string, end?: string | null, timeZone?: string | null): FlowusPropertyValue {
  const date: FlowusDateValue = { start, end: end ?? null, time_zone: timeZone ?? null };
  return { type: "date", date };
}

export function makeUrlProperty(url: string): FlowusPropertyValue {
  return { type: "url", url };
}

export function readPropertyValue(value?: FlowusPropertyValue): unknown {
  if (!value) return undefined;
  switch (value.type) {
    case "title":
      return plainTextFromRichText(value.title);
    case "rich_text":
      return plainTextFromRichText(value.rich_text);
    case "number":
      return value.number;
    case "select":
      return value.select?.name ?? null;
    case "multi_select":
      return value.multi_select.map((o) => o.name);
    case "date":
      return value.date;
    case "checkbox":
      return value.checkbox;
    case "url":
      return value.url;
    case "email":
      return value.email;
    case "phone_number":
      return value.phone_number;
    default:
      return undefined;
  }
}

export function readTitle(page: FlowusPage): string {
  const title = Object.values(page.properties).find((p) => p.type === "title");
  return title ? String(readPropertyValue(title) ?? "") : "";
}

export function projectUser(user: FlowusUser) {
  return {
    id: user.id,
    name: user.name ?? "",
    avatarUrl: user.avatar_url ?? null,
    workspaceId: user.workspace_id,
    workspaceName: user.workspace_name,
  };
}

export function projectDatabase(db: FlowusDatabase) {
  return {
    id: db.id,
    title: plainTextFromRichText(db.title),
    description: plainTextFromRichText(db.description),
    icon: db.icon,
    url: db.url,
    properties: Object.entries(db.properties).map(([key, prop]) => projectPropertySchema(key, prop)),
  };
}

function projectPropertySchema(name: string, prop: FlowusPropertySchema) {
  const options = prop.type === "select"
    ? (prop.select?.options ?? [])
    : prop.type === "multi_select"
      ? (prop.multi_select?.options ?? [])
      : undefined;
  return {
    id: prop.id ?? name,
    name: prop.name ?? name,
    type: prop.type,
    options,
  };
}

export function projectPage(page: FlowusPage) {
  return {
    id: page.id,
    title: readTitle(page),
    icon: page.icon,
    url: page.url,
    inTrash: page.in_trash,
    properties: Object.fromEntries(
      Object.entries(page.properties).map(([key, value]) => [key, readPropertyValue(value)]),
    ),
  };
}

export function projectPageList(list: FlowusList<FlowusPage>) {
  return {
    results: list.results.map(projectPage),
    nextCursor: list.next_cursor,
    hasMore: list.has_more,
  };
}

export function projectSearchResults(list: FlowusList<FlowusSearchResult>) {
  return {
    results: list.results.map((r) => ({
      pageId: r.page_id,
      title: r.page_title ?? "",
      snippet: r.snippet ?? "",
      score: r.score ?? 0,
      url: r.url ?? "",
    })),
    nextCursor: list.next_cursor,
    hasMore: list.has_more,
  };
}

export function buildPropertyValue(
  schema: FlowusPropertySchema,
  value: unknown,
): FlowusPropertyValue | undefined {
  if (schema.type === "title" && typeof value === "string") return makeTitleProperty(value);
  if (schema.type === "rich_text" && typeof value === "string") return makeRichTextProperty(value);
  if (schema.type === "select" && typeof value === "string") return makeSelectProperty(value);
  if (schema.type === "multi_select" && Array.isArray(value)) {
    return makeMultiSelectProperty(value.filter((v): v is string => typeof v === "string"));
  }
  if (schema.type === "checkbox" && typeof value === "boolean") return makeCheckboxProperty(value);
  if (schema.type === "url" && typeof value === "string") return makeUrlProperty(value);
  if (schema.type === "date" && typeof value === "string") return makeDateProperty(value);
  return undefined;
}

export function makeDatabaseSchema(fields: { name: string; type: FlowusPropertySchema["type"] }[]): Record<string, FlowusPropertySchema> {
  const schema: Record<string, FlowusPropertySchema> = {};
  for (const field of fields) {
    schema[field.name] = { name: field.name, type: field.type } as FlowusPropertySchema;
  }
  return schema;
}

export function makeParent(parentType: "workspace" | "page_id", id?: string): FlowusParent {
  if (parentType === "workspace") return { type: "workspace", workspace: true };
  return { type: "page_id", page_id: id };
}
