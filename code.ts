figma.showUI(__html__, { width: 450, height: 600 });

async function sendFileInfo() {
  const fileKey = figma.fileKey;
  
  figma.ui.postMessage({ 
    type: 'FILE_INFO', 
    payload: { 
      name: figma.root.name, 
      fileKey: fileKey || null,
    } 
  });
}

setTimeout(sendFileInfo, 500);

function getParentPage(node: BaseNode): PageNode | null {
  if (node.type === "PAGE") return node as PageNode;
  let parent = node.parent;
  while (parent && parent.type !== "PAGE") {
    if (parent.type === "DOCUMENT") return null;
    parent = parent.parent;
  }
  return parent as PageNode | null;
}

async function runAudit(manualKey?: string) {
  const fileKey = manualKey || figma.fileKey;

  if (!fileKey || fileKey === "null") {
    figma.notify("⚠️ Erreur : ID du fichier manquant.");
    return;
  }

  figma.notify("🚀 Scan du document entier en cours...");
  await figma.loadAllPagesAsync();

  const report = {
    documentName: figma.root.name,
    fileKey: fileKey,
    timestamp: new Date().toISOString(),
    stats: { totalInstances: 0, totalDetachedSuspects: 0, officialUsageCount: 0 },
    componentUsage: [] as any[],
    detachedSuspects: [] as any[],
    annotatedNodeIds: [] as string[] 
  };

  const OFFICIAL_PREFIXES = ["GE_", "MD_", "OCSTAT_"];
  const componentMap = new Map<string, any>();
  
  const allNodes = figma.root.findAll(n => true);

  for (const node of allNodes) {
    const parentPage = getParentPage(node);
    const pageName = parentPage ? parentPage.name : "Inconnue";

    // Dette (Annotations)
    if ('annotations' in node && node.annotations && node.annotations.length > 0) {
      report.annotatedNodeIds.push(node.id);
    }

    // Filtre structurel
    if (node.type !== "INSTANCE" && node.type !== "FRAME" && node.type !== "GROUP") continue;

    const nodeNameUpper = node.name.toUpperCase();
    const hasOfficialPrefix = OFFICIAL_PREFIXES.some(p => nodeNameUpper.startsWith(p));

    if (node.type === "INSTANCE") {
      const mainComp = await node.getMainComponentAsync();
      if (mainComp) {
        let fName = mainComp.name;
        let fId = mainComp.id;
        
        // --- CORRECTION SYNTAXE ICI ---
        // On remplace le ?. par une vérification && classique
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

  // Utilisation de Object.assign au lieu du spread operator pour les objets
  report.componentUsage = Array.from(componentMap.values())
    .map(c => {
      return Object.assign({}, c, { pages: Array.from(c.pages) });
    })
    .sort((a, b) => b.count - a.count);
    
  figma.ui.postMessage({ type: 'AUDIT_COMPLETE', payload: report });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'START_AUDIT') await runAudit(msg.manualKey);
  if (msg.type === 'REFRESH') sendFileInfo();
  if (msg.type === 'NOTIFY') figma.notify(msg.message);
};