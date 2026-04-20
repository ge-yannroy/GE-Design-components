/**
 * GE-DESIGN Audit Tool
 * Scans Figma documents to extract design debt, component usage, and quality metrics.
 */

figma.showUI(__html__, { width: 450, height: 600 });

/**
 * Sends current file metadata to the plugin UI.
 */
async function sendFileInfo() {
  const fileKey = figma.fileKey;
  figma.ui.postMessage({ 
    type: 'FILE_INFO', 
    payload: { 
      name: figma.root.name, 
      fileKey: fileKey || null,
      pageCount: figma.root.children.length 
    } 
  });
}

setTimeout(sendFileInfo, 500);

/**
 * Recursively finds the PageNode parent of any given node.
 * @param node - The node to start the search from.
 * @returns The parent PageNode or null if not found.
 */
function getParentPage(node: BaseNode): PageNode | null {
  if (node.type === "PAGE") return node as PageNode;
  let parent = node.parent;
  while (parent && parent.type !== "PAGE") {
    if (parent.type === "DOCUMENT") return null;
    parent = parent.parent;
  }
  return parent as PageNode | null;
}

/**
 * Executes the full document audit.
 * Processes annotations, official component instances, and detached layers.
 * @param manualKey - Optional file key if API detection fails.
 */
async function runAudit(manualKey?: string) {
  const fileKey = manualKey || figma.fileKey;

  if (!fileKey || fileKey === "null") {
    figma.notify("⚠️ Error: Missing File Key.");
    return;
  }

  figma.notify("🔍 Analyzing " + figma.root.children.length + " pages...");
  await figma.loadAllPagesAsync();

  const report = {
    documentName: figma.root.name,
    fileKey: fileKey,
    timestamp: new Date().toISOString(),
    stats: { 
      totalInstances: 0, 
      totalDetachedSuspects: 0, 
      officialUsageCount: 0,
      pagesScanned: figma.root.children.length,
      totalNodesChecked: 0
    },
    componentUsage: [] as any[],
    detachedSuspects: [] as any[],
    annotatedNodeIds: [] as string[] 
  };

  const OFFICIAL_PREFIXES = ["GE_", "MD_", "OCSTAT_"];
  const componentMap = new Map<string, any>();
  
  const allNodes = figma.root.findAll(n => true);
  report.stats.totalNodesChecked = allNodes.length;

  for (const node of allNodes) {
    const parentPage = getParentPage(node);
    const pageName = parentPage ? parentPage.name : "Unknown";

    if ('annotations' in node && node.annotations && node.annotations.length > 0) {
      report.annotatedNodeIds.push(node.id);
    }

    if (node.type !== "INSTANCE" && node.type !== "FRAME" && node.type !== "GROUP") continue;

    const nodeNameUpper = node.name.toUpperCase();
    const hasOfficialPrefix = OFFICIAL_PREFIXES.some(p => nodeNameUpper.startsWith(p));

    if (node.type === "INSTANCE") {
      const mainComp = await node.getMainComponentAsync();
      if (mainComp) {
        let fName = mainComp.name;
        let fId = mainComp.id;
        
        if (mainComp.parent && mainComp.parent.type === "COMPONENT_SET") {
          fName = mainComp.parent.name;
          fId = mainComp.parent.id;
        }

        if (OFFICIAL_PREFIXES.some(p => fName.toUpperCase().startsWith(p))) {
          report.stats.totalInstances++;
          report.stats.officialUsageCount++;
          if (!componentMap.has(fId)) {
            componentMap.set(fId, { name: fName, count: 0, pages: new Set() });
          }
          const data = componentMap.get(fId);
          data.count++;
          data.pages.add(pageName);
        }
      }
      continue;
    }

    if ((node.type === "FRAME" || node.type === "GROUP") && hasOfficialPrefix) {
      let isInside = false;
      let pObj = node.parent;
      while (pObj) {
        if (pObj.type === "INSTANCE" || pObj.type === "COMPONENT" || pObj.type === "COMPONENT_SET") { 
          isInside = true; 
          break; 
        }
        pObj = pObj.parent;
      }
      if (!isInside) {
        report.stats.totalDetachedSuspects++;
        report.detachedSuspects.push({
          id: node.id,
          name: node.name,
          page: pageName,
          figmaLink: "https://www.figma.com/file/" + fileKey + "?node-id=" + node.id.replace(/:/g, '-')
        });
      }
    }
  }

  report.componentUsage = Array.from(componentMap.values())
    .map(c => {
      return Object.assign({}, c, { pages: Array.from(c.pages) });
    })
    .sort((a, b) => b.count - a.count);
    
  figma.ui.postMessage({ type: 'AUDIT_COMPLETE', payload: report });
}

/**
 * Plugin message listener.
 */
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'START_AUDIT') await runAudit(msg.manualKey);
  if (msg.type === 'REFRESH') sendFileInfo();
  if (msg.type === 'NOTIFY') figma.notify(msg.message);
};