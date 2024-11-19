import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common'
import { RouterOutlet } from '@angular/router';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  '/home/chad/Desktop/ToMe/dev/pdf-editor/node_modules/pdfjs-dist/build/pdf.worker.mjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, FormsModule, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'pdf-editor';

  pdfDoc: any;
  existingPdfBytes: any;
  scale = 1;
  pdfCanvas: HTMLCanvasElement | undefined;
  ctx: CanvasRenderingContext2D | null = null;
  elements = ['Name', 'Date', 'Table'];
  selectedElement = 'Name'; // Default selected element
  coordinates: { [key: string]: { x: number; y: number } } = {};
  infoMessage = 'No coordinates selected yet.';
  downloadLink: string | null = null;
  elementColors: { [key: string]: string } = {
    Name: 'red',
    Date: 'blue',
    Table: 'green',
  }; // Color for each element
  values: { [key: string]: any } = { name: '', date: '', table: '' }; // Store user-provided values

  constructor() {
    // pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.js';
  }

  onFileChange(event: Event) {
    const fileInput = event.target as HTMLInputElement;
    if (fileInput.files && fileInput.files[0]) {
      const reader = new FileReader();
      reader.onload = async () => {
        const typedArray = new Uint8Array(reader.result as ArrayBuffer);
        this.existingPdfBytes = new Uint8Array(reader.result as ArrayBuffer);
        this.pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
      };
      reader.readAsArrayBuffer(fileInput.files[0]);
    }
  }

  async loadPdf() {
    if (!this.pdfDoc) {
      alert('Please upload a PDF first!');
      return;
    }
    this.renderPage(1);
  }

  renderPage(pageNum: number) {
    this.pdfDoc.getPage(pageNum).then((page: any) => {
      const viewport = page.getViewport({ scale: this.scale });
      this.pdfCanvas = document.getElementById(
        'pdfCanvas'
      ) as HTMLCanvasElement;
      this.ctx = this.pdfCanvas.getContext('2d');
      if (this.pdfCanvas) {
        this.pdfCanvas.width = viewport.width;
        this.pdfCanvas.height = viewport.height;
      }

      const renderContext = {
        canvasContext: this.ctx,
        viewport: viewport,
      };
      page.render(renderContext).promise.then(() => {
        this.drawCoordinates();
      });
    });
  }

  drawCoordinates() {
    if (!this.ctx || !this.pdfCanvas) return;

    Object.keys(this.coordinates).forEach((element) => {
      const coord = this.coordinates[element];
      const color = this.elementColors[element];
      this.ctx!.fillStyle = color;
      this.ctx!.font = '12px Arial';
      this.ctx!.fillText(element, coord.x, this.pdfCanvas!.height - coord.y);
    });
  }

  onCanvasClick(event: MouseEvent) {
    if (!this.pdfCanvas || !this.ctx) return;

    const rect = this.pdfCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.scale;
    const y = (this.pdfCanvas.height - (event.clientY - rect.top)) / this.scale;

    this.coordinates[this.selectedElement] = { x, y };
    this.infoMessage = `Coordinates for ${this.selectedElement}: (${x.toFixed(2)}, ${y.toFixed(2)})`;

    this.renderPage(1); // Re-render to update canvas with new coordinates
  }

  isReadyToGenerate(): boolean {
    // return this.elements.every((element) => this.coordinates[element]);
    return this.elements.every(
      (element) => this.coordinates[element] && this.values[element.toLowerCase()]
    );
  }


  async generatePdf() {
    if (!this.pdfDoc) {
      alert('Please upload a PDF first!');
      return;
    }

    const existingPdfBytes = await this.pdfDoc.getData();
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    const page = pdfDoc.getPages()[0];
    const { width } = page.getSize();
    const margin = 20;
    const tableStartX = margin; // Starting X position for the table
    const maxWidth = width - 2 * margin; // Maximum width for a cell
    const lineHeight = 12; // Line height for text
    const cellPadding = 5; // Padding inside each table cell

    // Load a font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
      const lines: string[] = [];
      let currentLine = '';

      const fitsWidth = (line: string) => font.widthOfTextAtSize(line, fontSize) <= maxWidth;

      text.split(' ').forEach((word) => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        if (fitsWidth(testLine)) {
          currentLine = testLine;
        } else {
          while (!fitsWidth(currentLine) && currentLine.length > 0) {
            let splitIndex = Math.floor(currentLine.length / 2);
            let splitLine = currentLine.slice(0, splitIndex);

            while (!fitsWidth(splitLine) && splitIndex > 0) {
              splitIndex -= 1;
              splitLine = currentLine.slice(0, splitIndex);
            }

            lines.push(splitLine);
            currentLine = currentLine.slice(splitIndex).trim();
          }

          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      });

      if (currentLine) lines.push(currentLine);
      return lines;
    };

    Object.keys(this.coordinates).forEach((element) => {
      const coord = this.coordinates[element];
      const value = this.values[element.toLowerCase()];

      if (element === 'Table') {
        const rows = value.split(',').map((row: string) => row.trim());
        let currentY = coord.y;

        rows.forEach((row: any) => {
          // Wrap text and calculate the required cell height
          const wrappedLines = wrapText(row, maxWidth - 2 * cellPadding, 10);
          const cellHeight = wrappedLines.length * lineHeight + 2 * cellPadding;

          // Draw the cell border
          page.drawRectangle({
            x: tableStartX,
            y: currentY - cellHeight,
            width: maxWidth,
            height: cellHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
          });

          // Draw each line of wrapped text inside the cell
          wrappedLines.forEach((line, lineIndex) => {
            page.drawText(line, {
              x: tableStartX + cellPadding,
              y: currentY - cellPadding - lineHeight * (lineIndex + 1),
              size: 10,
              font,
            });
          });

          // Move to the next row position
          currentY -= cellHeight;
        });
      } else {
        const wrappedLines = wrapText(value, maxWidth, 12);
        wrappedLines.forEach((line, index) => {
          page.drawText(line, {
            x: coord.x,
            y: coord.y - index * lineHeight,
            size: 12,
            font,
          });
        });
      }
    });

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    this.downloadLink = URL.createObjectURL(blob);
  }



  // async generatePdf() {
  //   if (!this.pdfDoc) {
  //     alert('Please upload a PDF first!');
  //     return;
  //   }

  //   const existingPdfBytes = await this.pdfDoc.getData();
  //   const pdfDoc = await PDFDocument.load(existingPdfBytes);

  //   const page = pdfDoc.getPages()[0];

  //   Object.keys(this.coordinates).forEach((element) => {
  //     const coord = this.coordinates[element];
  //     const text = element === 'Table' ? 'Table Data' : element; // Customize as needed
  //     page.drawText(text, {
  //       x: coord.x,
  //       y: coord.y,
  //       size: 12,
  //     });
  //   });

  //   const pdfBytes = await pdfDoc.save();
  //   const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  //   this.downloadLink = URL.createObjectURL(blob);
  // }
}
