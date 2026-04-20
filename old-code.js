"use strict";
figma.showUI(__html__, { width: 500, height: 600 });
// yGaZ9hfNb1uoD7n9ZHKttc - Modèles de pages
// GIZQNzPCllTJMl1UoQS5tD - SuisseVote
// NbOobcSvPaIDG7i1xXg0Nc - Skeleton
// 9a2PSbFEUUXpiT8yKLjwWf - Charte graphique
async function getFileKey() {
    if (figma.fileKey)
        return figma.fileKey;
    return "NbOobcSvPaIDG7i1xXg0Nc";
}
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
        componentUsage: [],
        detachedSuspects: [],
        annotatedNodeIds: []
    };
    const OFFICIAL_PREFIXES = ["GE_", "MD_", "OCSTAT_"];
    const componentMap = new Map();
    // --- ÉTAPE 1 : ÉLARGISSEMENT DU SCAN ---
    // On inclut COMPONENT et COMPONENT_SET pour ne rater aucune annotation "maître"
    /* const allNodes = figma.currentPage.findAll(n =>
      ["INSTANCE", "FRAME", "GROUP", "COMPONENT", "COMPONENT_SET"].includes(n.type)
    ); */
    const allNodes = figma.currentPage.findAll(n => true);
    // const allNodes = figma.root.findAll(n => true);
    for (const node of allNodes) {
        // --- ÉTAPE 2 : DÉTECTION DES ANNOTATIONS ---
        // On vérifie TOUS les nœuds du document sans exception
        if ('annotations' in node && node.annotations && node.annotations.length > 0) {
            report.annotatedNodeIds.push(node.id);
        }
        // --- ÉTAPE 3 : FILTRES POUR LA SUITE ---
        // Pour la logique BI et Qualité, on garde tes restrictions de types
        const isBIEligible = ["INSTANCE", "FRAME", "GROUP", "COMPONENT", "COMPONENT_SET"].includes(node.type);
        if (!isBIEligible)
            continue;
        // --- ÉTAPE 4 : LE "VIDEUR" POUR COMPOSANTS MAÎTRES ---
        if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
            continue;
        }
        const nodeNameUpper = node.name.toUpperCase();
        const hasOfficialPrefix = OFFICIAL_PREFIXES.some(prefix => nodeNameUpper.startsWith(prefix));
        // --- 4. LOGIQUE BI (STATISTIQUES) ---
        // Ne traite que les INSTANCES
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
                        let docUri = "";
                        if (mainComp.documentationLinks && mainComp.documentationLinks.length > 0) {
                            docUri = mainComp.documentationLinks[0].uri;
                        }
                        else if (parent && parent.type === "COMPONENT_SET" && parent.documentationLinks && parent.documentationLinks.length > 0) {
                            docUri = parent.documentationLinks[0].uri;
                        }
                        componentMap.set(finalId, {
                            name: finalName,
                            isOfficial: true,
                            description: mainComp.description || (parent && parent.type === "COMPONENT_SET" ? parent.description : ""),
                            documentationUri: docUri,
                            count: 0,
                            instances: []
                        });
                    }
                    const data = componentMap.get(finalId);
                    data.count++;
                    data.instances.push({
                        id: node.id,
                        layerName: node.name,
                        figmaLink: `https://www.figma.com/file/${fileKey}?node-id=${node.id.replace(':', '-')}`
                    });
                }
            }
            continue;
        }
        // --- 5. LOGIQUE QUALITÉ (DÉTACHÉS) ---
        // Ne traite que les FRAMES et GROUPS
        if ((node.type === "FRAME" || node.type === "GROUP") && hasOfficialPrefix) {
            let isInsideLegitimateComponent = false;
            let parentObj = node.parent;
            while (parentObj) {
                if (["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(parentObj.type)) {
                    isInsideLegitimateComponent = true;
                    break;
                }
                parentObj = parentObj.parent;
            }
            if (!isInsideLegitimateComponent) {
                const figmaLink = `https://www.figma.com/file/${fileKey}?node-id=${node.id.replace(':', '-')}`;
                report.stats.totalDetachedSuspects++;
                report.detachedSuspects.push({
                    id: node.id,
                    name: node.name,
                    page: figma.currentPage.name,
                    x: Math.round(node.x),
                    y: Math.round(node.y),
                    figmaLink,
                    reason: "Composant officiel détaché."
                });
            }
        }
    }
    report.componentUsage = Array.from(componentMap.values()).sort((a, b) => b.count - a.count);
    figma.ui.postMessage({ type: 'AUDIT_COMPLETE', payload: report });
}
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'START_AUDIT')
        await runAudit();
    if (msg.type === 'FOCUS_NODE') {
        try {
            const node = await figma.getNodeByIdAsync(msg.id);
            if (node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
                let pNode = node.parent;
                while (pNode && pNode.type !== "PAGE")
                    pNode = pNode.parent;
                if (pNode && pNode.type === "PAGE" && figma.currentPage !== pNode)
                    figma.currentPage = pNode;
                figma.viewport.scrollAndZoomIntoView([node]);
                figma.currentPage.selection = [node];
            }
        }
        catch (e) { }
    }
};
