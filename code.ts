/**
 * GE-DESIGN Audit Tool
 * Scans Figma documents to extract design debt, component usage, quality metrics,
 * and component keys for ge-builder config generation.
 */

figma.showUI(__html__, { width: 450, height: 600 });

/**
 * Sends current file metadata to the plugin UI.
 */
async function sendFileInfo(): Promise<void> {
  const fileKey = figma.fileKey;
  figma.ui.postMessage({
    type: 'FILE_INFO',
    payload: {
      name: figma.root.name,
      fileKey: fileKey || null,
      pageCount: figma.root.children.length,
    },
  });
}

setTimeout(sendFileInfo, 500);

/**
 * Recursively finds the PageNode parent of any given node.
 * @param node - The node to start the search from.
 * @returns The parent PageNode or null if not found.
 */
function getParentPage(node: BaseNode): PageNode | null {
  if (node.type === 'PAGE') return node as PageNode;
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE') {
    if (parent.type === 'DOCUMENT') return null;
    parent = parent.parent;
  }
  return parent as PageNode | null;
}

/**
 * Executes the full document audit.
 * Processes annotations, official component instances, detached layers,
 * and extracts component keys for ge-builder config generation.
 * @param manualKey - Optional file key if API detection fails.
 */
async function runAudit(manualKey?: string): Promise<void> {
  const fileKey = manualKey || figma.fileKey;

  if (!fileKey || fileKey === 'null') {
    figma.notify('⚠️ Error: Missing File Key.');
    return;
  }

  figma.notify('🔍 Analyzing ' + figma.root.children.length + ' pages...');
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
      totalNodesChecked: 0,
    },
    componentUsage:    [] as any[],
    detachedSuspects:  [] as any[],
    annotatedNodeIds:  [] as string[],
    annotationsData:   [] as any[],
    /**
     * Map flat de tous les composants officiels rencontrés :
     * { [componentName]: { key, name, variantProperties, count } }
     * Utilisé pour générer le ge-builder.config.json
     */
    geBuilderConfig:   {} as Record<string, any>,
  };

  const OFFICIAL_PREFIXES = ['GE_', 'MD_', 'OCSTAT_'];

  /** Map<componentSetId, { name, key, variants: Map<variantKey, variantInfo> }> */
  const componentMap = new Map<string, any>();

  /** Map<componentSetId, ComponentSetNode> pour accéder aux propriétés de variantes */
  const componentSetCache = new Map<string, ComponentSetNode>();

  const allNodes = figma.root.findAll(() => true);
  report.stats.totalNodesChecked = allNodes.length;

  for (const node of allNodes) {
    const parentPage = getParentPage(node);
    const pageName = parentPage ? parentPage.name : 'Unknown';

    // ── ANNOTATIONS ──────────────────────────────────────
    if ('annotations' in node && node.annotations && node.annotations.length > 0) {
      node.annotations.forEach((ann: any) => {
        const categoryMap: Record<string, string> = {
          '5207:0': 'Development',
          '5207:1': 'Interaction',
          '5207:2': 'Accessibility',
          '5207:3': 'Content',
          '12623:0': 'CRITIC',
        };
        const catId = ann.categoryId || '';
        const category = categoryMap[catId] || 'Question';
        const specification = ann.label || ann.notes || '';

        let authorName = 'Designer';
        try {
          if (ann.author && ann.author.name) {
            authorName = ann.author.name;
          } else if (figma.currentUser && figma.currentUser.name) {
            authorName = figma.currentUser.name;
          }
        } catch (e) {
          authorName = 'Designer';
        }

        report.annotationsData.push({
          id: node.id,
          component: node.name,
          category,
          specification,
          author: authorName,
          date: ann.createdAt || new Date().toISOString(),
          severity: category === 'CRITIC' ? 'CRITIQUE' : 'NORMAL',
        });
      });
    }

    if (node.type !== 'INSTANCE' && node.type !== 'FRAME' && node.type !== 'GROUP') continue;

    const nodeNameUpper = node.name.toUpperCase();
    const hasOfficialPrefix = OFFICIAL_PREFIXES.some((p) => nodeNameUpper.startsWith(p));

    // ── INSTANCES OFFICIELLES ─────────────────────────────
    if (node.type === 'INSTANCE') {
      const mainComp = await node.getMainComponentAsync();
      if (mainComp) {
        // Nom et ID du composant parent (ComponentSet si variantes, sinon Component)
        let familyName = mainComp.name;
        let familyId   = mainComp.id;
        // ← KEY de la variante spécifique utilisée
        let variantKey = mainComp.key;

        let componentSetNode: ComponentSetNode | null = null;

        if (mainComp.parent && mainComp.parent.type === 'COMPONENT_SET') {
          familyName      = mainComp.parent.name;
          familyId        = mainComp.parent.id;
          componentSetNode = mainComp.parent as ComponentSetNode;
        }

        if (OFFICIAL_PREFIXES.some((p) => familyName.toUpperCase().startsWith(p))) {
          report.stats.totalInstances++;
          report.stats.officialUsageCount++;

          // Cache du ComponentSet pour accès aux propriétés
          if (componentSetNode && !componentSetCache.has(familyId)) {
            componentSetCache.set(familyId, componentSetNode);
          }

          if (!componentMap.has(familyId)) {
            componentMap.set(familyId, {
              name:     familyName,
              familyId: familyId,
              count:    0,
              pages:    new Set<string>(),
              /**
               * Map<variantKey, { key, name, variantProperties, count }>
               * Chaque entrée correspond à une variante spécifique utilisée dans le fichier.
               */
              variants: new Map<string, any>(),
            });
          }

          const data = componentMap.get(familyId);
          data.count++;
          data.pages.add(pageName);

          // Enregistrer la variante spécifique avec sa key
          if (!data.variants.has(variantKey)) {
            data.variants.set(variantKey, {
              key:               variantKey,
              name:              mainComp.name,
              variantProperties: mainComp.variantProperties || {},
              count:             0,
            });
          }
          data.variants.get(variantKey).count++;
        }
      }
      continue;
    }

    // ── DÉTACHÉS SUSPECTS ─────────────────────────────────
    if ((node.type === 'FRAME' || node.type === 'GROUP') && hasOfficialPrefix) {
      let isInside = false;
      let pObj = node.parent;
      while (pObj) {
        if (
          pObj.type === 'INSTANCE' ||
          pObj.type === 'COMPONENT' ||
          pObj.type === 'COMPONENT_SET'
        ) {
          isInside = true;
          break;
        }
        pObj = pObj.parent;
      }
      if (!isInside) {
        report.stats.totalDetachedSuspects++;
        report.detachedSuspects.push({
          id:        node.id,
          name:      node.name,
          page:      pageName,
          figmaLink: 'https://www.figma.com/file/' + fileKey + '?node-id=' + node.id.replace(/:/g, '-'),
        });
      }
    }
  }

  // ── SÉRIALISATION componentUsage ─────────────────────────
  report.componentUsage = Array.from(componentMap.values())
    .map((c) => ({
      name:      c.name,
      familyId:  c.familyId,
      count:     c.count,
      pages:     Array.from(c.pages),
      /**
       * Liste des variantes utilisées dans le fichier, avec leur key publiée.
       * C'est cette liste qui permet de générer ge-builder.config.json.
       */
      variants: Array.from(c.variants.values()).sort((a: any, b: any) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);

  // ── GÉNÉRATION ge-builder.config ─────────────────────────
  /**
   * Construit une map plate nom → variants pour faciliter
   * la génération du fichier de config ge-builder.
   * Format :
   * {
   *   "GE_Header": {
   *     "variants": [
   *       { "key": "9176b5ec...", "name": "Device=Desktop, Context=Default", "count": 12 },
   *       ...
   *     ]
   *   }
   * }
   */
  report.componentUsage.forEach((comp) => {
    report.geBuilderConfig[comp.name] = {
      variants: comp.variants.map((v: any) => ({
        key:               v.key,
        name:              v.name,
        variantProperties: v.variantProperties,
        count:             v.count,
      })),
    };
  });

  figma.ui.postMessage({ type: 'AUDIT_COMPLETE', payload: report });
}

// ── LISTENER ─────────────────────────────────────────────
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'START_AUDIT') await runAudit(msg.manualKey);
  if (msg.type === 'REFRESH')     sendFileInfo();
  if (msg.type === 'NOTIFY')      figma.notify(msg.message);
};
