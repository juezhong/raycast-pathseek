import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { formatLocalTimestamp } from "./lib/trace-view";
import {
  getConfiguredIndexRoots,
  getConfiguredSymlinkDirectory,
  saveConfiguredIndexRoots,
  saveConfiguredSymlinkDirectory,
} from "./lib/index-roots";
import {
  indexDirectory,
  readIndex,
  rebuildIndex,
  type IndexMetadata,
} from "./lib/index-store";
import {
  readIndexBuildProgress,
  type IndexBuildProgress,
} from "./lib/index-progress";
import {
  getMissingBinary,
  missingBinaryMessage,
  HOMEBREW_INSTALL_COMMAND,
  HOMEBREW_URL,
} from "./lib/dependency-guide";

type Mode = "loading" | "configure" | "ready" | "building";

function ChooseFolders({
  initialRoots,
  initialSymlinkDirectory,
  actionTitle,
  onSave,
}: {
  initialRoots: string[];
  initialSymlinkDirectory: string | null;
  actionTitle: string;
  onSave: (
    roots: string[],
    symlinkDirectory: string | null,
  ) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function submit(values: {
    folders: string[];
    symlinkDirectory?: string[];
  }) {
    if (saving) return;
    setSaving(true);
    try {
      // 先验证普通索引根目录，再持久化选定的快捷链接目录。
      const roots = await saveConfiguredIndexRoots(values.folders);
      const symlinkDirectory = await saveConfiguredSymlinkDirectory(
        values.symlinkDirectory?.[0] ?? null,
      );
      await onSave(roots, symlinkDirectory);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Save Folders",
        message: String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Form
      isLoading={saving}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={actionTitle}
            icon={Icon.Folder}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Choose normal index folders and, optionally, ONE folder containing symlink shortcuts. Only direct directory symlinks in that folder are expanded. Other symlinks are never followed." />
      <Form.FilePicker
        id="folders"
        title="Index Folders"
        defaultValue={initialRoots}
        allowMultipleSelection
        canChooseDirectories
        canChooseFiles={false}
      />
      <Form.FilePicker
        id="symlinkDirectory"
        title="Symlink Shortcut Folder (Optional)"
        defaultValue={initialSymlinkDirectory ? [initialSymlinkDirectory] : []}
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
        info="Only direct directory symlinks inside this folder are expanded. The search results preserve the shortcut path."
      />
    </Form>
  );
}

function ChangeFolders({
  roots,
  symlinkDirectory,
  onSave,
}: {
  roots: string[];
  symlinkDirectory: string | null;
  onSave: (paths: string[], directory: string | null) => void;
}) {
  const { pop } = useNavigation();
  return (
    <ChooseFolders
      initialRoots={roots}
      initialSymlinkDirectory={symlinkDirectory}
      actionTitle="Save Selected Folders"
      onSave={(paths, directory) => {
        onSave(paths, directory);
        pop();
      }}
    />
  );
}

export default function RebuildIndex() {
  const [mode, setMode] = useState<Mode>("loading");
  const [roots, setRoots] = useState<string[]>([]);
  const [symlinkDirectory, setSymlinkDirectory] = useState<string | null>(null);
  const [current, setCurrent] = useState<IndexMetadata | null>(null);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<IndexBuildProgress | null>(null);
  const buildController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => buildController.current?.abort();
  }, []);

  useEffect(() => {
    if (mode !== "building") return;
    let active = true;
    const refresh = () => {
      void readIndexBuildProgress(indexDirectory).then((value) => {
        if (active) setProgress(value);
      });
    };
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    let mounted = true;
    async function initialize() {
      try {
        const metadata = await readIndex();
        const configured = await getConfiguredIndexRoots(metadata?.roots);
        const selectedLinks = await getConfiguredSymlinkDirectory();
        if (!mounted) return;
        setCurrent(metadata);
        setRoots(configured);
        setSymlinkDirectory(selectedLinks);
        // Missing index always gets the folder picker, even if a prior selection was saved.
        setMode(metadata && configured.length ? "ready" : "configure");
      } catch (failure) {
        if (mounted) {
          setError(String(failure));
          setMode("configure");
        }
      }
    }
    void initialize();
    return () => {
      mounted = false;
    };
  }, []);

  async function buildIndex(selectedRoots: string[]) {
    setError(undefined);
    setProgress(null);
    setMode("building");
    const controller = new AbortController();
    buildController.current = controller;
    try {
      // 仅用户主动触发，退出页面或点取消会停止 fd/压缩管道。
      const metadata = await rebuildIndex(selectedRoots, controller.signal);
      setCurrent(metadata);
      await showToast({
        style: Toast.Style.Success,
        title: "Index Built Successfully",
        message: metadata.count.toLocaleString() + " paths indexed",
      });
    } catch (failure) {
      if (controller.signal.aborted) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Index Build Cancelled",
          message: "The previous published index was preserved.",
        });
      } else {
        setError(String(failure));
        await showToast({
          style: Toast.Style.Failure,
          title: "Index Build Failed",
          message: String(failure),
        });
      }
    } finally {
      if (buildController.current === controller)
        buildController.current = null;
      setMode("ready");
    }
  }

  if (mode === "configure") {
    return (
      <ChooseFolders
        initialRoots={roots}
        initialSymlinkDirectory={symlinkDirectory}
        actionTitle="Choose Folders and Build Index"
        onSave={(chosen, directory) => {
          setRoots(chosen);
          setSymlinkDirectory(directory);
          void buildIndex(chosen);
        }}
      />
    );
  }

  const missingBinary = getMissingBinary(error);
  const mib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2) + " MiB";
  const activeSeconds = progress
    ? Math.max(0.001, progress.elapsedMs / 1000)
    : 0;
  const progressMarkdown = progress
    ? [
        `**Phase:** ${progress.phase} · root ${progress.rootNumber}/${progress.rootCount}`,
        `**Paths received:** ${progress.pathCount.toLocaleString()}`,
        `**Uncompressed path input:** ${mib(progress.inputBytes)}`,
        `**Compressed bytes emitted:** ${mib(progress.compressedBytes)}`,
        `**Input rate (whole-build average):** ${mib(progress.inputBytes / activeSeconds)}/s`,
        `**Elapsed:** ${(progress.elapsedMs / 1000).toFixed(1)} s`,
        `**Compression quality:** ${progress.compressionQuality}`,
        `**Extension CPU time:** ${(progress.cpuUserMs / 1000).toFixed(1)} s user + ${(progress.cpuSystemMs / 1000).toFixed(1)} s system (excludes fd process)`,
        `**Selective symlink targets:** ${progress.selectiveSymlinkTargets ?? 0}, skipped: ${progress.selectiveSymlinkSkipped ?? 0} · **Include hidden:** ${progress.includeHidden ? "yes" : "no"}`,
        `**Last scanner output:** ${progress.lastInputAt ? formatLocalTimestamp(progress.lastInputAt) : "not yet observed"}`,
        `**Last compressed output:** ${progress.lastOutputAt ? formatLocalTimestamp(progress.lastOutputAt) : "not yet observed"}`,
        "",
        "The compressed file size is **not** the volume of paths already scanned. The final index is published only after the build finishes.",
      ].join("\n\n")
    : "Preparing the rebuild and its progress recorder…";

  const markdown =
    mode === "loading"
      ? "# Build Index\n\nReading saved folders. No scan will start automatically."
      : mode === "building"
        ? "# Building Index\n\n" + progressMarkdown
        : [
            "# Build Index",
            "",
            "**Indexing is manual only.** Opening this command, Search Files or Index Status never starts a scan.",
            "",
            "**Selected folders**",
            roots.length
              ? roots.map((root) => "- " + root).join("\n")
              : "No folders selected.",
            "",
            current
              ? "Last successful build: **" +
                new Date(current.createdAt).toLocaleString() +
                "** · **" +
                current.count.toLocaleString() +
                "** indexed paths."
              : "No index exists. Select folders and explicitly build your first index.",
            "",
            "**Selective symlink directory:** " +
              (symlinkDirectory ?? "None") +
              "\n\nOnly direct directory links inside that folder are traversed. All other symlinks are not followed.",
            "",
            "Use **Cmd+K → Change Indexed Folders** to choose different directories. Saving a new selection does not automatically rebuild.",
            ...(error
              ? [
                  "",
                  "## Last Error",
                  missingBinary ? missingBinaryMessage(missingBinary) : error,
                ]
              : []),
          ].join("\n");

  return (
    <Detail
      isLoading={mode === "loading" || mode === "building"}
      markdown={markdown}
      actions={
        mode === "building" ? (
          <ActionPanel>
            <Action
              title="Cancel Index Build"
              icon={Icon.XMarkCircle}
              onAction={() => buildController.current?.abort()}
            />
          </ActionPanel>
        ) : mode === "ready" ? (
          <ActionPanel>
            <Action
              title="Rebuild Index Now"
              icon={Icon.ArrowClockwise}
              onAction={() => void buildIndex(roots)}
            />
            <Action.Push
              title="Change Indexed Folders"
              icon={Icon.Folder}
              target={
                <ChangeFolders
                  roots={roots}
                  symlinkDirectory={symlinkDirectory}
                  onSave={(paths, directory) => {
                    setRoots(paths);
                    setSymlinkDirectory(directory);
                  }}
                />
              }
            />
            {missingBinary && (
              <>
                <Action.CopyToClipboard
                  title="Copy fd/fzf Install Command"
                  icon={Icon.CopyClipboard}
                  content={HOMEBREW_INSTALL_COMMAND}
                />
                <Action.OpenInBrowser
                  title="How to Install Homebrew"
                  url={HOMEBREW_URL}
                />
              </>
            )}
            {current && (
              <Action.CopyToClipboard
                title="Copy Index Summary"
                content={JSON.stringify(current, null, 2)}
                icon={Icon.CopyClipboard}
              />
            )}
          </ActionPanel>
        ) : undefined
      }
    />
  );
}
