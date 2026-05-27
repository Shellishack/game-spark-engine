import { useState } from "react";
import { gameCreationTemplates, templateSupportsPhaser } from "../../data/game-templates";
import capability2dGameUrl from "../../assets/capability-2d-game.png";
import capability3dGameUrl from "../../assets/capability-3d-game.png";
import capability3dRenderingUrl from "../../assets/capability-3d-rendering.png";
import capabilityAssetsGenerationUrl from "../../assets/capability-assets-generation.png";
import shuffleIdeaAtlasUrl from "../../assets/shuffle-idea-atlas.png";
import { phaseLabels, randomGameIdeas, supportedEngines, supportedGameTypes, supportedStyles } from "../app-constants";
import { logInteraction } from "../app-telemetry";
import { engineLabel, formatRelativeDate } from "../app-utils";
import { WorkspacePicker, PromptComposer } from "./workspace-panels";
import type { GameEngine, WorkspaceInfo, WorkspaceProjectSummary } from "../../types/project-types";
const capabilityGallery = [
  {
    title: "2D games",
    eyebrow: "Phaser or Babylon",
    description: "Generate sprite-driven worlds, platformers, arcade loops, HUDs, and animation-ready 2D scenes.",
    imageUrl: capability2dGameUrl,
  },
  {
    title: "3D games",
    eyebrow: "BabylonJS runtime",
    description: "Build playable 3D worlds with characters, cameras, interaction logic, and real-time preview.",
    imageUrl: capability3dGameUrl,
  },
  {
    title: "3D rendering",
    eyebrow: "Realtime visuals",
    description: "Preview lighting, materials, scene composition, and cinematic shots directly inside the engine workspace.",
    imageUrl: capability3dRenderingUrl,
  },
  {
    title: "Asset generation",
    eyebrow: "AI production loop",
    description: "Create game-ready characters, props, sprites, textures, and style variants from chat-led tools.",
    imageUrl: capabilityAssetsGenerationUrl,
  },
];
const showcaseExamples = [
  {
    projectId: "cochem-gaussian-splat-showcase",
    title: "Cochem Imperial Castle",
    eyebrow: "Gaussian splat",
    description: "A Babylon.js SOG showcase using orbit controls and a local-first imported splat asset.",
    tags: ["Babylon.js", "SOG", "3D capture"],
  },
];
export function Home(
  props: {
    workspace: WorkspaceInfo;
    onSelectWorkspace: () => void;
    onResetWorkspace: () => void;
    onStart: () => void;
    onStartIdea: (idea: { projectName: string; prompt: string }) => void;
    onOpenProject: (project: WorkspaceProjectSummary) => void;
    workspaceProjects: WorkspaceProjectSummary[];
    projectName: string;
    projectNameError: string;
    selectedTemplateId: string;
    selectedEngine: GameEngine;
    onTemplateChange: (templateId: string) => void;
    onEngineChange: (engine: GameEngine) => void;
    onProjectNameChange: (value: string) => void;
    promptBlocks: import("../../types/project-types").PromptBlock[];
    onDraftChange: (content: string) => void;
    onAddAttachment: () => void;
  },
) {
  return (
    <section className="home-view">
      <div className="brand-row">
        <div className="home-brand">
          <div className="home-brand-badge">GS</div>
          <div className="brand-copy">
            <h1>Game Spark AI</h1>
            <div className="headline-carousel" aria-label="Game Spark AI highlights">
              <div>
                <span>Ship astonishing games with Codex</span>
                <span>Build your dream game in minutes</span>
                <span>Cursor but for games</span>
                <span>AI native game engine</span>
              </div>
            </div>
          </div>
        </div>
        <nav className="home-tabs" aria-label="Main page tabs">
          <button
            className="active"
            type="button"
            onClick={() => {
              logInteraction("home_tab_clicked", { tab: "home" });
              document.querySelector(".home-view")?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => {
              logInteraction("home_tab_clicked", { tab: "hub" });
              document.getElementById("home-hub")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Hub
          </button>
          <button
            type="button"
            onClick={() => {
              logInteraction("home_tab_clicked", { tab: "showcases" });
              document.getElementById("home-showcases")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Showcases
          </button>
        </nav>
        <div className="home-top-actions">
          <span className="status-pill">Local Codex backend</span>
        </div>
      </div>

      <CapabilityGallery />
      <ShowcaseSection projects={props.workspaceProjects} onOpenProject={props.onOpenProject} />

      <div className="home-hub-grid" id="home-hub">
        <div className="home-main-column">
          <PromptComposer
            showGameSelectors
            projectNameControls={{
              value: props.projectName,
              onChange: props.onProjectNameChange,
              error: props.projectNameError,
            }}
            workspaceControls={{
              workspace: props.workspace,
              onSelectWorkspace: props.onSelectWorkspace,
              onResetWorkspace: props.onResetWorkspace,
            }}
            selectedTemplateId={props.selectedTemplateId}
            selectedEngine={props.selectedEngine}
            onTemplateChange={props.onTemplateChange}
            onEngineChange={props.onEngineChange}
            promptBlocks={props.promptBlocks}
            actionLabel="Generate game"
            onDraftChange={props.onDraftChange}
            onAddAttachment={props.onAddAttachment}
            onSubmit={props.onStart}
          />
          <RecentGames projects={props.workspaceProjects} onOpenProject={props.onOpenProject} />
        </div>
        <aside className="home-side-column">
          <RandomIdeas onPickIdea={props.onProjectNameChange} onDraftChange={props.onDraftChange} onStartIdea={props.onStartIdea} />
          <SupportedTypes />
        </aside>
      </div>
    </section>
  );
}

function CapabilityGallery() {
  return (
    <section className="capability-section" aria-label="Game engine capabilities">
      <div className="capability-section-copy">
        <p className="eyebrow">AI-native game engine</p>
        <h2>Design, generate, edit, and playtest from one canvas.</h2>
        <p>
          Game Spark AI combines chat-led production tools with live engine previews so ideas can move from concept to playable
          scenes without leaving the editor.
        </p>
      </div>
      <div className="capability-gallery">
        {capabilityGallery.map((item, index) => (
          <article className={`capability-card capability-card-${index + 1}`} key={item.title}>
            <img src={item.imageUrl} alt="" />
            <div>
              <span>{item.eyebrow}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ShowcaseSection({ projects, onOpenProject }: { projects: WorkspaceProjectSummary[]; onOpenProject: (project: WorkspaceProjectSummary) => void }) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  return (
    <section className="showcase-section" id="home-showcases" aria-label="Showcase examples">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Showcase examples</p>
          <h2>Open ready-made engine scenes.</h2>
        </div>
        <span>{showcaseExamples.length} examples</span>
      </div>
      <div className="showcase-grid">
        {showcaseExamples.map((showcase) => {
          const project = projectsById.get(showcase.projectId);
          return (
            <article className="showcase-card" key={showcase.projectId}>
              <div className="showcase-preview" aria-hidden="true">
                <div className="showcase-splat" />
                <span>3D</span>
              </div>
              <div className="showcase-copy">
                <span>{showcase.eyebrow}</span>
                <h3>{showcase.title}</h3>
                <p>{showcase.description}</p>
                <div className="showcase-tags">
                  {showcase.tags.map((tag) => (
                    <small key={tag}>{tag}</small>
                  ))}
                </div>
              </div>
              <div className="showcase-footer">
                <small>{project?.hasBuild ? "Preview ready" : "Project not found"}</small>
                <button
                  type="button"
                  disabled={!project}
                  onClick={() => {
                    if (!project) return;
                    logInteraction("showcase_opened", { projectId: project.id, projectTitle: project.title });
                    onOpenProject(project);
                  }}
                >
                  View
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
function RecentGames({ projects, onOpenProject }: { projects: WorkspaceProjectSummary[]; onOpenProject: (project: WorkspaceProjectSummary) => void }) {
  return (
    <section className="existing-projects-band" aria-label="Existing projects">
      <div className="section-heading">
        <h2>Recent games</h2>
        <span>{projects.length} workspaces</span>
      </div>
      <div className="existing-project-grid">
        {projects.length === 0 ? (
          <article className="existing-project-card empty">
            <div className="existing-project-thumb">
              <span>GS</span>
            </div>
            <div>
              <h3>No local games yet</h3>
              <p>Generated games in the selected workspace will appear here.</p>
            </div>
          </article>
        ) : null}
        {projects.map((project) => (
          <article className="existing-project-card" key={project.id}>
            <div className="existing-project-thumb" style={{ backgroundColor: project.color }}>
              <span>{project.title.slice(0, 2)}</span>
            </div>
            <div>
              <h3>{project.title}</h3>
              <p>{project.description}</p>
            </div>
            <div className="existing-project-footer">
              <div className="project-card-meta">
                <span>{phaseLabels[project.status] ?? project.status}</span>
                <span>{formatRelativeDate(project.updatedAt)}</span>
              </div>
              <button type="button" onClick={() => onOpenProject(project)}>
                Open
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RandomIdeas({
  onPickIdea,
  onDraftChange,
  onStartIdea,
}: {
  onPickIdea: (projectTitle: string) => void;
  onDraftChange: (content: string) => void;
  onStartIdea: (idea: { projectName: string; prompt: string }) => void;
}) {
  const [idea, setIdea] = useState(randomGameIdeas[0]);
  function shuffleIdea() {
    setIdea((current) => {
      const pool = randomGameIdeas.filter((candidate) => candidate.title !== current.title);
      const nextIdea = pool[Math.floor(Math.random() * pool.length)] ?? current;
      logInteraction("random_idea_shuffled", { from: current.title, to: nextIdea.title });
      return nextIdea;
    });
  }
  function buildIdea() {
    logInteraction("random_idea_build_clicked", { title: idea.title, promptLength: idea.prompt.length });
    onPickIdea(idea.title);
    onDraftChange(idea.prompt);
    onStartIdea({ projectName: idea.title, prompt: idea.prompt });
  }
  const ideaIndex = randomGameIdeas.findIndex((candidate) => candidate.title === idea.title);
  const atlasColumn = Math.max(0, ideaIndex % 5);
  const atlasRow = Math.max(0, Math.floor(ideaIndex / 5));

  return (
    <section className="random-idea-band" aria-label="Try something random">
      <div className="section-heading">
        <h2>Try something random</h2>
      </div>
      <div className="random-idea-card">
        <div
          className="random-idea-thumb"
          style={{
            backgroundImage: `url(${shuffleIdeaAtlasUrl})`,
            backgroundPosition: `${atlasColumn * 25}% ${atlasRow * 33.3333}%`,
          }}
        >
          <span>{idea.title.slice(0, 2)}</span>
        </div>
        <div>
          <h3>{idea.title}</h3>
          <p>{idea.prompt}</p>
        </div>
      </div>
      <div className="random-idea-actions">
        <button className="secondary-button" type="button" onClick={shuffleIdea}>
          Shuffle
        </button>
        <button type="button" onClick={buildIdea}>
          Build this
        </button>
      </div>
    </section>
  );
}

function SupportedTypes() {
  const pageSize = 3;
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(gameCreationTemplates.length / pageSize);
  const visibleTemplates = gameCreationTemplates.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <section className="template-band" aria-label="Game type templates">
      <div className="section-heading">
        <h2>Game templates</h2>
        <span>
          {page + 1} / {pageCount}
        </span>
      </div>
      <div className="template-grid">
        {visibleTemplates.map((template) => (
          <article className="template-card" key={template.id}>
            <div className="template-icon">{template.icon}</div>
            <div>
              <h3>{template.title}</h3>
              <p>{template.description}</p>
              <small>{template.type}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="template-pagination" aria-label="Template pagination">
        <button
          type="button"
          onClick={() =>
            setPage((current) => {
              const nextPage = Math.max(0, current - 1);
              logInteraction("template_page_changed", { direction: "previous", from: current + 1, to: nextPage + 1 });
              return nextPage;
            })
          }
          disabled={page === 0}
        >
          Previous
        </button>
        <div>
          {Array.from({ length: pageCount }, (_, index) => (
            <span className={index === page ? "active" : ""} key={index} />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setPage((current) => {
              const nextPage = Math.min(pageCount - 1, current + 1);
              logInteraction("template_page_changed", { direction: "next", from: current + 1, to: nextPage + 1 });
              return nextPage;
            })
          }
          disabled={page === pageCount - 1}
        >
          Next
        </button>
      </div>
      <div className="support-inline" aria-label="Supported styles">
        <span>Supported types</span>
        {supportedGameTypes.map((type) => (
          <small key={type}>{type}</small>
        ))}
        <span>Styles</span>
        {supportedStyles.map((style) => (
          <small key={style}>{style}</small>
        ))}
      </div>
    </section>
  );
}

