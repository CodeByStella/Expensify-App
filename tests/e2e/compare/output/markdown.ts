// From: https://raw.githubusercontent.com/callstack/reassure/main/packages/reassure-compare/src/output/markdown.ts
import fs from 'node:fs/promises';
import path from 'path';
import type {Stats} from 'tests/e2e/measure/math';
import * as Logger from '../../utils/logger';
import type {Data, Entry} from './console';
import * as format from './format';
import markdownTable from './markdownTable';

const TIMES_TO_SPLIT_MEANINGLESS_CHANGES = 1;

const tableHeader = ['Name', 'Duration'];

const collapsibleSection = (title: string, content: string) => `<details>\n<summary>${title}</summary>\n\n${content}\n</details>\n\n`;

const buildDurationDetails = (title: string, entry: Stats, unit: string) => {
    const relativeStdev = entry.stdev / entry.mean;

    return [
        `**${title}**`,
        `Mean: ${format.formatMetric(entry.mean, unit)}`,
        `Stdev: ${format.formatMetric(entry.stdev, unit)} (${format.formatPercent(relativeStdev)})`,
        entry.entries ? `Runs: ${entry.entries.join(' ')}` : '',
    ]
        .filter(Boolean)
        .join('<br/>');
};

const buildDurationDetailsEntry = (entry: Entry) =>
    ['baseline' in entry ? buildDurationDetails('Baseline', entry.baseline, entry.unit) : '', 'current' in entry ? buildDurationDetails('Current', entry.current, entry.unit) : '']
        .filter(Boolean)
        .join('<br/><br/>');

const formatEntryDuration = (entry: Entry): string => {
    if ('baseline' in entry && 'current' in entry) {
        return format.formatMetricDiffChange(entry);
    }

    if ('baseline' in entry) {
        return format.formatMetric((entry as Entry).baseline.mean, (entry as Entry).unit);
    }

    if ('current' in entry) {
        return format.formatMetric((entry as Entry).current.mean, (entry as Entry).unit);
    }

    return '';
};

const buildDetailsTable = (entries: Entry[], timesToSplit = 0) => {
    if (!entries.length) {
        return '';
    }

    const entriesPerTable = Math.floor(entries.length / timesToSplit);
    const tables: string[] = [];
    for (let i = 0; i < timesToSplit; i++) {
        const start = i * entriesPerTable;
        const end = i === timesToSplit - 1 ? entries.length : start + entriesPerTable;
        const tableEntries = entries.slice(start, end);

        const rows = tableEntries.map((entry) => [entry.name, buildDurationDetailsEntry(entry)]);
        const content = markdownTable([tableHeader, ...rows]);

        const tableMarkdown = collapsibleSection('Show details', content);

        tables.push(tableMarkdown);
    }

    return tables;
};

const buildSummaryTable = (entries: Entry[], collapse = false) => {
    if (!entries.length) {
        return '_There are no entries_';
    }

    const rows = entries.map((entry) => [entry.name, formatEntryDuration(entry)]);
    const content = markdownTable([tableHeader, ...rows]);

    return collapse ? collapsibleSection('Show entries', content) : content;
};

const buildMarkdown = (data: Data, skippedTests: string[]) => {
    let mainFile = '## Performance Comparison Report 📊';
    mainFile += TIMES_TO_SPLIT_MEANINGLESS_CHANGES > 0 ? ` (1/${TIMES_TO_SPLIT_MEANINGLESS_CHANGES + 1})` : '';

    if (data.errors?.length) {
        mainFile += '\n\n### Errors\n';
        data.errors.forEach((message) => {
            mainFile += ` 1. 🛑 ${message}\n`;
        });
    }

    if (data.warnings?.length) {
        mainFile += '\n\n### Warnings\n';
        data.warnings.forEach((message) => {
            mainFile += ` 1. 🟡 ${message}\n`;
        });
    }

    if (skippedTests.length > 0) {
        mainFile += `⚠️ Some tests did not pass successfully, so some results are omitted from final report: ${skippedTests.join(', ')}`;
    }

    mainFile += '\n\n### Significant Changes To Duration';
    mainFile += `\n${buildSummaryTable(data.significance)}`;
    mainFile += `\n${buildDetailsTable(data.significance).at(0)}`;

    const meaninglessDetailsTables = buildDetailsTable(data.meaningless, TIMES_TO_SPLIT_MEANINGLESS_CHANGES);

    const extraFiles: string[] = [];
    for (let i = 0; i < TIMES_TO_SPLIT_MEANINGLESS_CHANGES; i++) {
        let extraFile = '## Performance Comparison Report 📊';
        extraFile += TIMES_TO_SPLIT_MEANINGLESS_CHANGES > 0 ? ` (${i + 2}/${TIMES_TO_SPLIT_MEANINGLESS_CHANGES + 1})` : '';

        extraFile += '\n\n### Meaningless Changes To Duration';
        extraFile += TIMES_TO_SPLIT_MEANINGLESS_CHANGES > 0 ? ` (${i + 1}/${TIMES_TO_SPLIT_MEANINGLESS_CHANGES + 1})` : '';

        extraFile += `\n${buildSummaryTable(data.meaningless, true)}`;
        extraFile += `\n${meaninglessDetailsTables[i]}`;
        extraFile += '\n';

        extraFiles.push(extraFile);
    }

    return [mainFile, ...extraFiles];
};

const writeToFile = (filePath: string, content: string) =>
    fs
        .writeFile(filePath, content)
        .then(() => {
            Logger.info(`✅  Written output markdown output file ${filePath}`);
            Logger.info(`🔗 ${path.resolve(filePath)}\n`);
        })
        .catch((error) => {
            Logger.info(`❌  Could not write markdown output file ${filePath}`);
            Logger.info(`🔗 ${path.resolve(filePath)}`);
            console.error(error);
            throw error;
        });

const writeToMarkdown = (outputDir: string, data: Data, skippedTests: string[]) => {
    const markdownFiles = buildMarkdown(data, skippedTests);
    const filesString = markdownFiles.join('\n\n');
    Logger.info('Markdown was built successfully, writing to file...', filesString);

    if (markdownFiles.length === 1) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return writeToFile(path.join(outputDir, 'output.md'), markdownFiles.at(0)!);
    }

    return Promise.all(
        markdownFiles.map((file, index) => {
            const filePath = `${outputDir}/output-${index + 1}.md`;
            return writeToFile(filePath, file).catch((error) => {
                console.error(error);
                throw error;
            });
        }),
    );
};

export default writeToMarkdown;
export {buildMarkdown};
