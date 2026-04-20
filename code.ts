/**
 * GE-Design-component Audit Plugin (Legacy Version)
 * Provides interactive audit capabilities within the Figma UI,
 * including component usage tracking, debt detection, and node focusing.
 */

figma.showUI(__html__, { width: 500, height: 600 });

/**
 * Retrieves the unique identifier for the current Figma file.
 * @returns {Promise<string>} The Figma file key.
 */
async function getFileKey(): Promise<string> {
  if (figma.fileKey) return figma.fileKey;
  return "NbOobcSvPaIDG7i1xXg0Nc";
}

/**
 * Traverses the node tree upwards to find the parent PageNode.
 * @param {BaseNode} node - The node to start the search from.
 * @returns {PageNode | null} The parent page or null if not found.
 */
function getParentPage(node: BaseNode): PageNode | null {
  let parent = node.parent;
  while (parent && parent.type !== "PAGE") {
    if (parent.type === "DOCUMENT") return null;
    parent = parent.parent;
  }
  return parent as PageNode | null;
}

/**
 * Main audit function. 
 * Scans the current page for annotations, official component usage, and detached layers.
 * Sends the compiled report to the UI.
 */
async function runAudit() {
  await figma.loadAllPagesAsync();
  const fileKey = await getFileKey();

  const report = {
    documentName: figma.root.name,
    fileKey: fileKey,
    timestamp: new Date().toISOString(),
    stats: {
      totalInstances: 0,
      totalDetachedSuspects: 0,
      officialUsageCount: 0
    },
    componentUsage: [] as any[],
    detachedSuspects: [] as any[],
    annotatedNodeIds: [] as string[] 
  };

  const OFFICIAL_PREFIXES = ["GE_", "MD_", "OCSTAT_"];
  const componentMap = new Map<string, any>();

  // Full scan of the current page
  const allNodes = figma.currentPage.findAll(n => true);

  for (const node of allNodes) {
    const parentPage = getParentPage(node);
    const pageName = parentPage ? parentPage.name : figma.currentPage.name;

    // 1. Detection of Figma Annotations
    if ('annotations' in node && node.annotations && node.annotations.length > 0) {
      report.annotatedNodeIds.push(node.id);
    }

    // 2. Structural filtering
    const isBIEligible = ["INSTANCE", "FRAME", "GROUP", "COMPONENT", "COMPONENT_SET"].includes(node.type);
    if (!isBIEligible) continue;

    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") continue;

    const nodeNameUpper = node.name.toUpperCase();
    const hasOfficialPrefix = OFFICIAL_PREFIXES.some(prefix => nodeNameUpper.startsWith(prefix));

    // 3. Official Component Usage Logic
    if (node.type === "INSTANCE") {
      const mainComp = await node.getMainComponentAsync();
      if (mainComp) {
        let finalName = mainComp.name;
        let finalId = mainComp.id;
        const parent = mainComp.parent;

        if (parent && parent.type === "COMPONENT_SET") {
          finalName = parent.name;
          finalId = parent.id;
        }

        const isOfficial = OFFICIAL_PREFIXES.some(prefix => finalName.toUpperCase().startsWith(prefix));
        
        if (isOfficial) {
          report.stats.totalInstances++;
          report.stats.officialUsageCount++;

          if (!componentMap.has(finalId)) {
            componentMap.set(finalId, {
              name: finalName,
              count: 0,
              pages: new Set() 
            });
          }

          const data = componentMap.get(finalId);
          data.count++;
          data.pages.add(pageName);
        }
      }
      continue;
    }

    // 4. Detached Layers Detection (Quality Audit)
    if ((node.type === "FRAME" || node.type === "GROUP") && hasOfficialPrefix) {
      let isInsideLegitimateComponent = false;
      let pObj = node.parent;
      while (pObj) {
        if (["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(pObj.type)) {
          isInsideLegitimateComponent = true;
          break;
        }
        pObj = pObj.parent;
      }

      if (!isInsideLegitimateComponent) {
        report.stats.totalDetachedSuspects++;
        report.detachedSuspects.push({
          id: node.id,
          name: node.name,
          page: pageName,
          figmaLink: `https://www.figma.com/file/${fileKey}?node-id=${node.id.replace(/:/g, '-')}`
        });
      }
    }
  }

  // Final data preparation for the UI (Converting Sets to Arrays)
  report.componentUsage = Array.from(componentMap.values())
    .map(c => {
      return Object.assign({}, c, {
        pages: Array.from(c.pages)
      });
    })
    .sort((a, b) => b.count - a.count);
  
  figma.ui.postMessage({ type: 'AUDIT_COMPLETE', payload: report });
}

/**
 * Main message handler for UI communication.
 */
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'START_AUDIT') await runAudit();

  if (msg.type === 'FOCUS_NODE') {
    try {
      const node = await figma.getNodeByIdAsync(msg.id);
      if (node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
        const targetPage = getParentPage(node);
        
        // Page switching if necessary
        if (targetPage && figma.currentPage !== targetPage) {
          figma.currentPage = targetPage;
        }

        // Delay to ensure the viewport is ready after page switch
        setTimeout(() => {
          figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
          figma.currentPage.selection = [node as SceneNode];
        }, 50);
      }
    } catch (e) {
      console.error("Focus error:", e);
    }
  }
};