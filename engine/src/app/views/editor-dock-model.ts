export type EditorPanelId = "navigator" | "assistant" | "preview";

export type EditorPanelLayout = {
  id: EditorPanelId;
  title: string;
  port: string;
};

export type EditorDockGroupId = "left" | "center" | "right";

export type EditorDockGroup = {
  id: EditorDockGroupId;
  title: string;
  panelId: EditorPanelId | null;
  activePanelId: EditorPanelId | null;
  collapsed: boolean;
};

export const editorPanelCatalog: Record<EditorPanelId, EditorPanelLayout> = {
  navigator: { id: "navigator", title: "Project ports", port: "Tools / Assets / Settings" },
  assistant: { id: "assistant", title: "AI co-editor", port: "Chat / Logic / Generation" },
  preview: { id: "preview", title: "Runtime viewport", port: "Scene / Inspector / Playtest" },
};

export const defaultDockGroups: EditorDockGroup[] = [
  { id: "left", title: "Navigator", panelId: "navigator", activePanelId: "navigator", collapsed: false },
  { id: "center", title: "AI workbench", panelId: "assistant", activePanelId: "assistant", collapsed: false },
  { id: "right", title: "Runtime", panelId: "preview", activePanelId: "preview", collapsed: false },
];

export const dockGroupDefaults: Record<EditorDockGroupId, Pick<EditorDockGroup, "id" | "title">> = {
  left: { id: "left", title: "Navigator" },
  center: { id: "center", title: "AI workbench" },
  right: { id: "right", title: "Runtime" },
};
