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
import { indexFilePath, type IndexMetadata } from "./lib/index-store";
import {
  findIndexedDirectoryChoices,
  parseSubtreeQuery,
} from "./lib/subtree-search";

const HELP = `# Search Syntax Guide

By default PathSeek matches only each indexed file or directory name with \`fzf --extended --read0 --print0 --filter\`. A search is not a live filesystem scan.

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

## Fuzzy path segments

Use / to separate **directory levels** from the final file or directory name. Every level is matched independently (fzf-style extended conditions and ordered fuzzy characters), in the same order as the actual path. You may omit earlier ancestor directories and type only a suffix of the directory hierarchy.

- For first/second/third/fourth: th/for, third/fou and fir/seco/th/four all match fourth.
- For a Chinese directory 第一次 containing 第二次.txt: dyc/dec matches that file.
- th/ lists entries **directly inside** directories matching th.
- dir/.pdf$ filters PDF filenames directly inside matching dir directories; the final segment still uses fzf extended syntax.
- Levels must be consecutive: first/third/fourth does not skip the second directory.
- Every directory level supports Smart Case (lowercase ignores case, uppercase is sensitive), fuzzy characters, \`'exact\`, \`^prefix\`, \`suffix$\`, \`!exclude\`, AND (space), and OR (standalone \`|\`).
- Chinese, English, pinyin initials and full pinyin are always searchable in every directory level and the final name. Extended operators retain fzf syntax.
- Only / activates path mode. Without /, existing filename-only fzf search remains unchanged.
- \`fzf\` extended syntax is **not** full regex: patterns such as \`a.*b\` are not treated as regular expressions.

All checks read the existing local index; no on-demand filesystem traversal, second index, or background service is added.

## Recursive Search Within a Folder

- \`raypath/ .ts$\` and \`raypath//.ts$\` enter subtree mode: choose the indexed folder matching \`raypath\`, then search all descendants for names ending in \`.ts\`.
- \`first/second/ so file\` uses existing consecutive fuzzy directory matching to locate \`second\`, then recursively searches descendant names with fzf AND terms.
- \`raypath/.ts$\` (without space or double slash) keeps its old behavior, matching only direct children of fuzzy-matching parent folders.
- When several folders match, choose the intended one in the directory picker. Highlight a compatible directory before typing \`/ \` or \`//\` to use that selected folder instead.
- On an indexed folder result, use Search Within This Folder from the Action Panel. Tab is configured but must be checked in Raycast; the menu action works independently.
- Only indexed paths are searched. \`/first/\` does not include \`/first-other/\`. No fd scans, extra indexes, or automatic symlink following are added.
- \`.ts$\` is the fzf suffix operator; \`*.ts\` and \`.*ts\` are not supported glob/regex expressions.

## Chinese Pinyin

For every query, PathSeek supplies temporary pinyin initials and full readings of Chinese names to fzf. The query shape only determines whether special Chinese result slots are reserved. Examples for Chinese file/folder names:

- \`dyc\`, \`d y c\` — ordered or separate initials
- \`yc d\`, \`y c d\` — the independent terms can appear in any order
- \`diyici\` — full pinyin of \`第一次\`
- \`dec\`, \`derc\`, \`d erc\`, \`d er c\` — common matching forms of \`第二次\`
- \`2026 dyc\` — both year and initials must appear in **the same name**, not its parent folders

Pinyin aliases are generated **only while searching**, not stored in a second index. They support the same \`fzf\` matcher, but no transliteration library can guarantee every polyphonic proper name. Complex \`fzf\` operators (\`!\`, \`^\`, \`$\`, \`'\`, \`|\`) retain native fzf syntax while searching both original names and phonetic aliases.

## Notes

- Prefix and suffix anchors apply to the **file/directory name**, never the parent path.
- Multiple terms separated by spaces mean AND; a standalone \`|\` means OR.
- Results are capped at 150. For Latin/pinyin queries, a bounded selection reserves slots for Chinese names beyond the top-ranked ASCII results. The retained output scan is also bounded.
- If an exact Chinese filename cannot be found, manually rebuild the index; searches never scan new files automatically.
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
      const preview = async () => {
        const subtree = parseSubtreeQuery(expression);
        if (!subtree) return fuzzySearch(index, expression, controller.signal);
        const choices = await findIndexedDirectoryChoices(
          indexFilePath(index),
          subtree.directoryPatterns,
          controller.signal,
        );
        if (choices.paths.length !== 1 || choices.truncated) {
          throw new Error(
            "Subtree preview needs one matching directory. Apply the expression in the main list to choose a folder.",
          );
        }
        return fuzzySearch(
          index,
          subtree.nameQuery,
          controller.signal,
          choices.paths[0],
        );
      };
      void preview()
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
        placeholder="src/.pdf$"
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
