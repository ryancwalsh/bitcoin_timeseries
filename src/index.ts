/* eslint-disable perfectionist/sort-modules -- TODO: Find where this rule is coming from and whether it differs from the rule that wants functions to be defined before they are used. */

// Run `npx tsx src/index.ts --verbose`.

import chalk from 'chalk'; // https://www.npmjs.com/package/chalk
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs'; // https://github.com/yargs/yargs/

const timeseriesFilename = 'BTC-USD_daily.csv';
const currentFile = fileURLToPath(import.meta.url); // https://stackoverflow.com/a/72462507/470749
const timeseriesFilePath = path.resolve(path.dirname(currentFile), timeseriesFilename);

const args = yargs(process.argv.slice(2))
  .option('verbose', {
    alias: 'vvv',
    description: 'Enable verbose mode',
    type: 'boolean',
  })
  .parseSync(); // https://github.com/yargs/yargs/blob/main/docs/typescript.md

const isVerbose = args.verbose ?? false;

type Row = {
  date: Date;
  price: number;
};

type Drawdown = {
  duration: number;
  end: Date;
  highWaterMark: number;
  start: Date;
  trough: Row;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(value);
}

function formatNumber(value: number): string {
  return value >= 1_000 ? new Intl.NumberFormat('en-US').format(value) : value.toString();
}

function daysToYears(days: number): string {
  return (days / 365).toFixed(1); // Converts to years and rounds to 1 decimal place
}

function getSimpleDate(dateAsString: string): string {
  return dateAsString.slice(0, 10);
}

function summarizeDrawdown(drawdown: Drawdown): string {
  const yearsOrBlank = drawdown.duration > 30 ? ` (${daysToYears(drawdown.duration)} years)` : ``;
  return `${getSimpleDate(drawdown.start.toISOString())} 🡺 ${getSimpleDate(drawdown.trough.date.toISOString())} 🡺 ${getSimpleDate(drawdown.end.toISOString())}. ${formatNumber(drawdown.duration)} days${yearsOrBlank}. ${formatCurrency(drawdown.highWaterMark)} 🡺 ${formatCurrency(drawdown.trough.price)}`;
}

/**
 * Instantiate partialDrawdown with meaningless values.
 * Only when partialDrawdown gets updated later with a non-zero duration will its values make sense.
 */
function instantiatePartialDrawdown(row: Row): Drawdown {
  return {
    duration: 0,
    end: row.date,
    highWaterMark: row.price,
    start: row.date,
    trough: {
      date: row.date,
      price: row.price,
    },
  };
}

// eslint-disable-next-line max-lines-per-function
function getDrawdowns(rows: Row[]): Drawdown[] {
  if (rows.length === 0) {
    throw new Error('No rows found.');
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const peakRow = rows[0];
  const drawdowns: Drawdown[] = [];
  let partialDrawdown: Drawdown | null = null;

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.price < peakRow.price && index !== rows.length - 1) {
      if (partialDrawdown) {
        const duration = (row.date.getTime() - partialDrawdown.start.getTime()) / (1_000 * 60 * 60 * 24);
        partialDrawdown.duration = duration;
        partialDrawdown.end = row.date;
        if (row.price < partialDrawdown.trough.price) {
          partialDrawdown.trough = {
            date: row.date,
            price: row.price,
          };
        }

        if (isVerbose) {
          console.log(chalk.dim(`In drawdown:`, summarizeDrawdown(partialDrawdown)));
        }
      } else {
        partialDrawdown = instantiatePartialDrawdown(row);
      }
    } else {
      peakRow.price = row.price;
      peakRow.date = row.date;
      if (partialDrawdown) {
        if (partialDrawdown.duration > 0) {
          drawdowns.push(partialDrawdown);
          // Now that the drawdown has finished, log it:
          console.log(`Drawdown #${formatNumber(drawdowns.length)}:`, summarizeDrawdown(partialDrawdown), isVerbose ? partialDrawdown : '');
        }

        partialDrawdown = null;
      }
    }
  }

  return drawdowns;
}

function findLongestDrawdown(drawdowns: Drawdown[]): Drawdown | null {
  if (drawdowns.length === 0) {
    return null;
  }

  let longestDrawdown = drawdowns[0];
  for (let index = 1; index < drawdowns.length; index += 1) {
    if (drawdowns[index].duration > longestDrawdown.duration) {
      longestDrawdown = drawdowns[index];
    }
  }

  return longestDrawdown;
}

async function readCSV(filePath: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const dataPoints: Row[] = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const firstPartOfDateString = getSimpleDate(row.Date as string);
        dataPoints.push({
          date: new Date(firstPartOfDateString),
          price: Number.parseFloat((row.Price as string).replaceAll(',', '')),
        });
      })
      .on('end', () => {
        if (isVerbose) {
          console.log('CSV file successfully processed');
        }

        resolve(dataPoints);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

async function processData() {
  try {
    const rows = await readCSV(timeseriesFilePath);
    const drawdowns = getDrawdowns(rows);
    const longestDrawdown = findLongestDrawdown(drawdowns);
    console.log(chalk.bold.greenBright(`Longest drawdown:`, longestDrawdown && summarizeDrawdown(longestDrawdown)), longestDrawdown);
  } catch (error) {
    console.error('Error reading CSV:', error);
  }
}

processData();
