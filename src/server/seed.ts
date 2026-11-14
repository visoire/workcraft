// The sample project template: files that open in the four apps. Used by "Load sample data"
// (openSample in projects.ts), by New project with samples, and on the first start only when
// WORKCRAFT_FIRST_PROJECT=sample. A normal installation starts with an empty project of its own.
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { markdownToDocx } from './office/docs.js';
import { writeSheet } from './office/sheets.js';
import { buildSampleDeck } from './office/slides.js';
import { textPdf } from './office/pdf.js';

const WELCOME = `# Welcome to WorkCraft

WorkCraft connects WordCraft, GridCraft, DeckCraft and PdfCraft with a code editor, a terminal and an AI assistant. All files live in this project folder on your computer.

## In the chat

- **@** picks files, projects and apps as context, for example @finances.xlsx or @wordcraft.
- **/** forces a tool, for example /read-sheet or /create-slide.
- Example: read the quarterly figures of @finances.xlsx with @gridcraft, write a report in @wordcraft and three slides in @deckcraft.

## Windows

Every panel can be shown full screen, minimized, maximized and hidden, and an app can open in a window of its own (a second display). Minimized apps stay loaded and pause their graphics.
`;

export async function seedProject(root: string): Promise<void> {
  const put = async (p: string, data: Uint8Array | string) => {
    const abs = join(root, p);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  };
  await put('README.md', '# Sample project\n\nThis project lives locally on your computer under ~/workcraft/projects/.\n');
  await put('documents/welcome.md', WELCOME);
  await put(
    'documents/proposal.docx',
    await markdownToDocx('# Proposal: web project\n\nThis document lives in the project folder and opens in **WordCraft**.\n\n## Services\n\n- Concept and design\n- Build as a local application\n- Offline use\n\n## Price\n\n12,400 euros net, payable in two instalments.\n', 'Proposal')
  );
  await put(
    'sheets/finances.xlsx',
    await writeSheet(null, 'xlsx', {
      sheet: 'Quarters',
      mode: 'replace',
      cells: {
        A1: 'Quarter', B1: 'Revenue', C1: 'Costs', D1: 'Result', E1: 'Margin %',
        A2: 'Q1', B2: 48200, C2: 31900, D2: '=B2-C2', E2: '=ROUND(D2/B2*100,1)',
        A3: 'Q2', B3: 53650, C3: 34100, D3: '=B3-C3', E3: '=ROUND(D3/B3*100,1)',
        A4: 'Q3', B4: 58900, C4: 36250, D4: '=B4-C4', E4: '=ROUND(D4/B4*100,1)',
        A5: 'Q4', B5: 66400, C5: 39800, D5: '=B5-C5', E5: '=ROUND(D5/B5*100,1)',
        A6: 'Year', B6: '=SUM(B2:B5)', C6: '=SUM(C2:C5)', D6: '=SUM(D2:D5)', E6: '=ROUND(D6/B6*100,1)',
        A8: 'Revenue sorted', B8: '=SORT(B2:B5,1,-1)',
      },
    })
  );
  await put('sheets/contacts.csv', 'Name,Company,City\nMara Lindt,Studio North,Hamburg\nJonas Pietsch,Atelier South,Munich\nEwa Nowak,Office East,Leipzig\n');
  await put(
    'presentations/start.pptx',
    await buildSampleDeck({ quarters: ['Q1', 'Q2', 'Q3', 'Q4'], revenue: [48200, 53650, 58900, 66400], costs: [31900, 34100, 36250, 39800] })
  );
  await put(
    'pdf/contract.pdf',
    await textPdf('Sample contract', [
      ['Sample contract', 'Studio North and Atelier South agree on the following.', 'This document is confidential.', '1. Service', 'The contractor builds a local application.', '2. Fee', 'The fee is 12,400 euros net.', '3. Confidentiality', 'Both parties treat all information as confidential.'],
    ])
  );
  await put('code/main.js', '// Example\nexport const margin = (revenue, costs) => Math.round(((revenue - costs) / revenue) * 1000) / 10;\n');
}
