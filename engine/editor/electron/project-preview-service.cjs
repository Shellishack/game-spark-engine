const path = require("node:path");
const { createPreviewCore } = require("../../cli/dist/preview-core.js");

function createProjectPreviewService({ appRoot, workspaceRoot }) {
  const repoRoot = path.resolve(appRoot, "..", "..");
  const core = createPreviewCore({
    repoRoot,
    editorRoot: appRoot,
  });

  async function workspace() {
    return workspaceRoot();
  }

  return {
    async startPreviewServer(_event, projectId) {
      return core.startPreviewServer({ project: projectId, workspace: await workspace() });
    },
    async rebuildProjectPreview(_event, projectId) {
      return core.rebuildProjectPreview({ project: projectId, workspace: await workspace(), startServer: true });
    },
    async readSceneFile(_event, projectId, scenePath) {
      return core.readSceneFile({ project: projectId, workspace: await workspace(), scenePath });
    },
    async updateSceneObject(_event, projectId, scenePath, objectId, transform) {
      return core.updateSceneObject({ project: projectId, workspace: await workspace(), scenePath, objectId, transform });
    },
    async stopPreviewServer(projectId) {
      const resolved = await core.resolveProjectRoot(projectId, await workspace());
      if (resolved.ok) await core.stopPreviewServer(resolved.projectRoot);
    },
  };
}

module.exports = { createProjectPreviewService };
