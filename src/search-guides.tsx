import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import path from "node:path";
import { fuzzySearch } from "./lib/fuzzy-search";
import type { IndexMetadata } from "./lib/index-store";

const HELP = `# Search Syntax Guide

PathSeek searches **only each indexed file or directory name** with \`fzf --extended --read0 --print0 --filter\`. A search is not a live filesystem scan.

| Expression | Behavior |
| --- | --- |
| \`driver\` | Ordered fuzzy characters in the file/directory name |
| \`'driver\` | Exact substring |
| \`'driver'\` | Exact word boundary match |
| \`^driver\` | Name starts with \`driver\` |
| \`.pdf$\` | Name ends with \`.pdf\` |
| \`!node_modules\` | Exclude names containing \`node_modules\` |
| \`driver .c$\` | Both conditions must match (AND) |
| \`.c$ | .h$\` | Either alternative may match (OR) |

## Chinese Pinyin

For simple Latin-letter/digit queries (including spaces), PathSeek also supplies temporary pinyin initials and full readings of Chinese names to fzf. Examples for \`第一次\`:

- \`dyc\`, \`d y c\` — ordered or separate initials
- \`yc d\`, \`y c d\` — the independent terms can appear in any order
- \`diyici\` — full pinyin
- \`2026 dyc\` — both year and initials must appear in **the same name**, not its parent folders

Pinyin aliases are generated **only while searching**, not stored in a second index. They support the same \`fzf\` matcher, but no transliteration library can guarantee every polyphonic proper name. Complex \`fzf\` operators (\`!\`, \`^\`, \`$\`, \`'\`, \`|\`) still use native fzf syntax, restricted to the **original file/directory name**.

## Notes

- Prefix and suffix anchors apply to the **file/directory name**, never the parent path.
- Multiple terms separated by spaces mean AND; a standalone \`|\` means OR.
- Results are capped at 150. Opening the guide or expression editor never starts \`fd\`.
- Use **Compose Expression & Preview** to see real matching files before pressing Enter.


`;

export function SearchSyntaxHelp() {
  return (
    <Detail navigationTitle="fzf Search Syntax & Pinyin" markdown={HELP} />
  );
}

function SearchExpressionBuilder({
  index,
  initialQuery,
  onApply,
}: {
  index: IndexMetadata | null | undefined;
  initialQuery: string;
  onApply: (value: string) => void;
}) {
  const { pop } = useNavigation();
  const [expression, setExpression] = useState(initialQuery);
  const [preview, setPreview] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreview([]);
    setPreviewError(undefined);
    if (!index || !expression.trim()) {
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);
    const timer = setTimeout(() => {
      fuzzySearch(index, expression, controller.signal)
        .then((paths) => {
          if (!controller.signal.aborted) setPreview(paths);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setPreviewError(String(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [index, expression]);

  const status = !index
    ? "No index yet. Build Index first."
    : !expression.trim()
      ? "Enter a pattern to preview matching paths."
      : loading
        ? "Running the same fzf filter used by Search Indexed Files…"
        : previewError
          ? previewError
          : preview.length
            ? `${preview.length}${preview.length === 150 ? "+" : ""} matching paths (showing up to 5)`
            : "No matching indexed paths.";

  return (
    <Form
      navigationTitle="Compose Search Expression"
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Apply Expression and Search"
            icon={Icon.MagnifyingGlass}
            onSubmit={(values: { expression: string }) => {
              if (!values.expression.trim()) return;
              onApply(values.expression);
              pop();
            }}
          />
          <Action.Push
            title="Search Syntax Help"
            icon={Icon.QuestionMarkCircle}
            target={<SearchSyntaxHelp />}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="expression"
        title="Expression"
        placeholder="report .pdf$"
        value={expression}
        onChange={setExpression}
        autoFocus
      />
      <Form.Description title="Preview" text={status} />
      {preview.slice(0, 5).map((filepath, i) => (
        <Form.Description
          key={filepath}
          title={`#${i + 1}`}
          text={path.basename(filepath) + " — " + path.dirname(filepath)}
        />
      ))}
      <Form.Description
        title="How it works"
        text="Preview runs on the saved index using fzf. Enter applies the expression to the main search. The editor does not scan the filesystem or change settings."
      />
    </Form>
  );
}

export function SearchAssistanceActions({
  index,
  query,
  onApply,
}: {
  index: IndexMetadata | null | undefined;
  query: string;
  onApply: (value: string) => void;
}) {
  return (
    <ActionPanel.Section title="Search Assistance">
      <Action.Push
        title="Compose Expression & Preview"
        icon={Icon.Pencil}
        target={
          <SearchExpressionBuilder
            index={index}
            initialQuery={query}
            onApply={onApply}
          />
        }
      />
      <Action.Push
        title="Search Syntax Help"
        icon={Icon.QuestionMarkCircle}
        target={<SearchSyntaxHelp />}
      />
    </ActionPanel.Section>
  );
}
