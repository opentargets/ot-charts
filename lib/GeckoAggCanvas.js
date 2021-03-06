import React from 'react';
import * as d3 from 'd3';
import _ from 'lodash';
import { withContentRect } from 'react-measure';
import theme from './theme';

const LEGEND_HEIGHT = 50;
const GENE_SLOT_HEIGHT = 25;
const GENE_TRANSCRIPT_HEIGHT = 5;
const GENE_TRANSCRIPT_OFFSET = 2;
const GENE_BACKDROP_PADDING = 2;
const GENE_TRACK_PADDING = 5;
const STUDY_SLOT_HEIGHT = 50;
const STUDY_TEXT_MAX_WIDTH = 200;
const TAG_VARIANT_BLOCK_SLOT_HEIGHT = 10;
const VARIANT_TRACK_HEIGHT = 7;
const CONNECTOR_TRACK_HEIGHT = 80;
const CHAR_WIDTH = 8; // TODO: base on font-size
const CHAR_HEIGHT = 12;
const HEIGHT_DEFAULT = 400;
const SCALE_FACTOR = 2;
const HIDDEN_TYPE_MAP = {
  gene: 1,
  tagVariantBlock: 2,
  indexVariant: 3,
  study: 4,
};
const HIDDEN_TYPE_MAP_INVERSE = {};
Object.keys(HIDDEN_TYPE_MAP).forEach(
  k => (HIDDEN_TYPE_MAP_INVERSE[HIDDEN_TYPE_MAP[k]] = k)
);
const ENTITY_WIDTH = 34;
const ENTITY_RADIUS = 13;

const color = (d, noSelectedEntities) =>
  d.selected
    ? theme.gecko.colorSelected
    : !noSelectedEntities && d.chained
      ? theme.gecko.colorChained
      : theme.gecko.color;
const tagVariantBlockColor = (d, noSelectedEntities) =>
  d.expansionType === 'fm'
    ? d.selected
      ? theme.gecko.finemappingColorSelected
      : !noSelectedEntities && d.chained
        ? theme.gecko.finemappingColorChained
        : theme.gecko.finemappingColor
    : d.selected
      ? theme.gecko.colorSelected
      : !noSelectedEntities && d.chained
        ? theme.gecko.colorChained
        : theme.gecko.color;
const backgroundColor = (d, noSelectedEntities) =>
  d.selected
    ? theme.gecko.backgroundColorSelected
    : !noSelectedEntities && d.chained
      ? theme.gecko.backgroundColorChained
      : theme.gecko.backgroundColor;
const connectorColor = (d, noSelectedEntities) =>
  d.expansionType === 'fm'
    ? d.selected
      ? theme.gecko.finemappingConnectorColorSelected
      : !noSelectedEntities && d.chained
        ? theme.gecko.finemappingConnectorColorChained
        : theme.gecko.finemappingConnectorColor
    : d.selected
      ? theme.gecko.connectorColorSelected
      : !noSelectedEntities && d.chained
        ? theme.gecko.connectorColorChained
        : theme.gecko.connectorColor;

const wrapText = (text, maxLineWidth, measure) => {
  const lines = [];
  const spaceWidth = measure(' ');
  let wordsLeft = text.split(' ');
  let currentLine = '';
  let currentLineWidth = 0;
  let currentMaxLineWidth = 0;
  while (wordsLeft.length > 0) {
    const word = wordsLeft.shift();
    const wordWidth = measure(word);
    if (currentLineWidth + wordWidth < maxLineWidth) {
      // word fits on current line
      currentLine += (currentLineWidth > 0 ? ' ' : '') + word;
      currentLineWidth += (currentLineWidth > 0 ? spaceWidth : 0) + wordWidth;
      currentMaxLineWidth =
        currentLineWidth > currentMaxLineWidth
          ? currentLineWidth
          : currentMaxLineWidth;
    } else {
      if (wordWidth < maxLineWidth) {
        // word doesn't fit on line, but fits on next
        lines.push(currentLine);
        currentLine = word;
        currentLineWidth = wordWidth;
        currentMaxLineWidth =
          currentLineWidth > currentMaxLineWidth
            ? currentLineWidth
            : currentMaxLineWidth;
      } else {
        // word doesn't fit on a single line
        // TODO: wrap single word
        lines.push(currentLine);
        currentLine = word;
        currentLineWidth = wordWidth;
        currentMaxLineWidth =
          currentLineWidth > currentMaxLineWidth
            ? currentLineWidth
            : currentMaxLineWidth;
      }
    }
    // last word?
    if (wordsLeft.length === 0) {
      lines.push(currentLine);
    }
  }
  return {
    lines,
    width: currentMaxLineWidth,
  };
};

class Gecko extends React.Component {
  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
    this.hiddenCanvasRef = React.createRef();
  }
  componentDidMount() {
    this._render();
  }
  componentDidUpdate() {
    this._render();
  }
  render() {
    const { measureRef } = this.props;
    const { width, height } = this._dimensions();
    return (
      <div
        ref={measureRef}
        style={{
          width: `100%`,
          height: `${height}px`,
          position: 'relative',
        }}
      >
        <canvas
          width={width ? width * SCALE_FACTOR : 0}
          height={height * SCALE_FACTOR}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
          ref={node => (this.canvasRef = node)}
        />
        <canvas
          width={width ? width * SCALE_FACTOR : 0}
          height={height * SCALE_FACTOR}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            position: 'absolute',
            top: 0,
            left: 0,
            imageRendering: 'pixelated',
            opacity: 0,
          }}
          ref={node => (this.hiddenCanvasRef = node)}
        />
      </div>
    );
  }
  _width() {
    const { contentRect } = this.props;
    const { width } = contentRect.bounds;
    return width;
  }
  _height() {
    const { data, start, end } = this.props;
    const width = this._width();
    if (this._bail(data, width)) {
      return HEIGHT_DEFAULT;
    }
    const scalePosition = d3
      .scaleLinear()
      .domain([start, end])
      .range([0, width]);

    const { slots: geneSlots } = this._geneSlots(data.genes, scalePosition);
    const { slots: tagVariantBlockSlots } = this._tagVariantBlocksSlots(
      data.tagVariantBlocks,
      scalePosition
    );
    const canvas = this.canvasRef;
    const context = canvas.getContext('2d');
    const studiesWithWrappedLabels = this._studiesWithWrappedLabels(
      data.studies,
      context
    );
    const { trackHeight: studiesTrackHeight } = this._studyScaleY(
      studiesWithWrappedLabels,
      width
    );
    const trackConfig = this._trackConfig(
      geneSlots.length,
      tagVariantBlockSlots.length,
      studiesTrackHeight ? studiesTrackHeight : 0
    );
    return trackConfig.height;
  }
  _dimensions() {
    const width = this._width();
    const height = this._height();
    return { width, height };
  }

  _bail(data, width) {
    return (
      !width ||
      !data ||
      !data.tagVariantBlocks ||
      !data.genes ||
      !data.indexVariants ||
      !data.geneIndexVariantStudies ||
      !data.studies
    );
  }
  _render() {
    const {
      data: rawData,
      start,
      end,
      showGeneVerticals,
      handleClick,
      handleMousemove,
      selectedGenes,
      selectedTagVariantBlocks,
      selectedIndexVariants,
      selectedStudies,
    } = this.props;
    const { colorMap, ...data } = this._generateHiddenColors(rawData);

    const noSelectedEntities =
      !selectedGenes &&
      !selectedTagVariantBlocks &&
      !selectedIndexVariants &&
      !selectedStudies;

    const width = this._width();
    if (this._bail(data, width)) {
      return null;
    }

    const canvas = this.canvasRef;
    const context = canvas.getContext('2d');
    const hiddenCanvas = this.hiddenCanvasRef;
    const hiddenContext = hiddenCanvas.getContext('2d');

    d3.select(hiddenCanvas).on('mousemove', function() {
      const point = d3.mouse(this);
      const [r, g, b, a] = hiddenContext.getImageData(
        Math.round(point[0]) * SCALE_FACTOR,
        Math.round(point[1]) * SCALE_FACTOR,
        1,
        1
      ).data;
      const color = `rgb(${r},${g},${b},${a})`;
      const item = colorMap[color];
      if (item) {
        const type = HIDDEN_TYPE_MAP_INVERSE[r >> 4];
        d3.select(hiddenCanvas).style('cursor', 'pointer');
        handleMousemove(item, type, point);
      } else {
        d3.select(hiddenCanvas).style('cursor', 'auto');
      }
    });

    d3.select(hiddenCanvas).on('click', function() {
      const point = d3.mouse(this);
      const [r, g, b, a] = hiddenContext.getImageData(
        Math.round(point[0]) * SCALE_FACTOR,
        Math.round(point[1]) * SCALE_FACTOR,
        1,
        1
      ).data;
      const color = `rgb(${r},${g},${b},${a})`;
      const item = colorMap[color];
      if (item) {
        const type = HIDDEN_TYPE_MAP_INVERSE[r >> 4];
        handleClick(item, type, point);
      }
    });

    const scalePosition = d3
      .scaleLinear()
      .domain([start, end])
      .range([0, width]);

    const { slots: geneSlots, genesWithSlots } = this._geneSlots(
      data.genes,
      scalePosition
    );
    const {
      slots: tagVariantBlockSlots,
      tagVariantBlocksWithSlots,
    } = this._tagVariantBlocksSlots(data.tagVariantBlocks, scalePosition);
    const scaleStudyX = this._studyScaleX(data.studies, width);
    const studiesWithWrappedLabels = this._studiesWithWrappedLabels(
      data.studies,
      context
    );
    const { scaleStudyY, trackHeight: studiesTrackHeight } = this._studyScaleY(
      studiesWithWrappedLabels,
      width
    );
    const trackConfig = this._trackConfig(
      geneSlots.length,
      tagVariantBlockSlots.length,
      studiesTrackHeight
    );

    context.save();
    context.imageSmoothingEnabled = true;
    context.scale(SCALE_FACTOR, SCALE_FACTOR);
    context.clearRect(0, 0, width, trackConfig.height);

    hiddenContext.save();
    hiddenContext.scale(SCALE_FACTOR, SCALE_FACTOR);
    hiddenContext.imageSmoothingEnabled = false;
    hiddenContext.webkitImageSmoothingEnabled = false;
    hiddenContext.mozImageSmoothingEnabled = false;
    hiddenContext.msImageSmoothingEnabled = false;
    hiddenContext.oImageSmoothingEnabled = false;
    hiddenContext.clearRect(0, 0, width, trackConfig.height);

    this._renderLegend(context, width);
    this._renderGenes(
      context,
      hiddenContext,
      scalePosition,
      trackConfig.genes,
      genesWithSlots,
      noSelectedEntities,
      showGeneVerticals
    );
    this._renderTagVariantBlocks(
      context,
      hiddenContext,
      scalePosition,
      trackConfig.tagVariantBlocks,
      tagVariantBlocksWithSlots,
      noSelectedEntities
    );
    this._renderIndexVariants(
      context,
      hiddenContext,
      scalePosition,
      trackConfig.indexVariants,
      data.indexVariants,
      noSelectedEntities
    );
    this._renderStudies(
      context,
      hiddenContext,
      scaleStudyX,
      scaleStudyY,
      trackConfig.studies,
      data.studies,
      noSelectedEntities
    );
    this._renderGeneIndexVariantStudies(
      context,
      scalePosition,
      scaleStudyX,
      trackConfig.geneTagVariants,
      trackConfig.tagVariantIndexVariants,
      trackConfig.indexVariantStudies,
      data.geneIndexVariantStudies,
      noSelectedEntities
    );
    this._renderEntities(
      context,
      trackConfig,
      selectedGenes,
      selectedTagVariantBlocks,
      selectedIndexVariants,
      selectedStudies
    );

    context.restore();
    hiddenContext.restore();
  }
  _renderEntities(
    context,
    trackConfig,
    selectedGenes,
    selectedTagVariantBlocks,
    selectedIndexVariants,
    selectedStudies
  ) {
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 2;

    const x = ENTITY_WIDTH / 2;
    const fill = theme.grey[300];
    const text = theme.grey[500];
    const fillFixed = theme.primary;
    const textFixed = 'white';

    // G
    const yG = trackConfig.genes.top + ENTITY_WIDTH / 2;
    context.fillStyle = selectedGenes ? fillFixed : fill;
    context.strokeStyle = selectedGenes ? fillFixed : text;
    context.beginPath();
    context.arc(x, yG, ENTITY_RADIUS, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    context.fillStyle = selectedGenes ? textFixed : text;
    context.font = 'bold 12px sans-serif';
    context.fillText('G', x, yG);

    // TV
    const yTV =
      (trackConfig.tagVariantBlocks.top + trackConfig.tagVariantBlocks.bottom) /
      2;
    context.fillStyle = selectedTagVariantBlocks ? fillFixed : fill;
    context.strokeStyle = selectedTagVariantBlocks ? fillFixed : text;
    context.beginPath();
    context.arc(x, yTV, ENTITY_RADIUS, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    context.fillStyle = selectedTagVariantBlocks ? textFixed : text;
    context.font = 'bold 12px sans-serif';
    context.fillText('V', x - 2, yTV);
    context.font = 'bold 9px sans-serif';
    context.fillText('T', x + 4, yTV + 5);

    // IV
    const yIV =
      (trackConfig.indexVariants.top + trackConfig.indexVariants.bottom) / 2;
    context.fillStyle = selectedIndexVariants ? fillFixed : fill;
    context.strokeStyle = selectedIndexVariants ? fillFixed : text;
    context.beginPath();
    context.arc(x, yIV, ENTITY_RADIUS, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    context.fillStyle = selectedIndexVariants ? textFixed : text;
    context.font = 'bold 12px sans-serif';
    context.fillText('V', x - 2, yIV);
    context.font = 'bold 9px sans-serif';
    context.fillText('L', x + 4, yIV + 5);

    // S
    const yS = trackConfig.studies.top + ENTITY_WIDTH / 2;
    context.fillStyle = selectedStudies ? fillFixed : fill;
    context.strokeStyle = selectedStudies ? fillFixed : text;
    context.beginPath();
    context.arc(x, yS, ENTITY_RADIUS, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    context.fillStyle = selectedStudies ? textFixed : text;
    context.font = 'bold 12px sans-serif';
    context.fillText('S', x, yS);

    context.restore();
  }
  _renderLegend(context, width) {
    context.save();

    context.textAlign = 'start';
    context.textBaseline = 'middle';
    context.font = '12px sans-serif';

    const side = 10;
    const label = LEGEND_HEIGHT / 3;
    const middle = (LEGEND_HEIGHT * 2) / 3;
    const top = middle - side / 2;
    const textOffset = 12;
    const itemOffset = 55;
    const groupOffset = 165;
    const textColor = theme.gecko.color;

    const xDefaultEntity = top;
    const xDefaultConnector = xDefaultEntity + itemOffset;
    const xDefaultConnectorFinemapping = xDefaultConnector + itemOffset;
    const xSelectedEntity = xDefaultConnectorFinemapping + groupOffset;
    const xChainedEntity = xSelectedEntity + groupOffset;
    const xChainedConnector = xChainedEntity + itemOffset;
    const xChainedConnectorFinemapping = xChainedConnector + itemOffset;

    // background
    context.fillStyle = theme.gecko.legend;
    context.fillRect(0, 0, width, LEGEND_HEIGHT);

    // default entity
    context.fillStyle = theme.gecko.color;
    context.fillRect(xDefaultEntity, top, side, side);
    context.fillStyle = textColor;
    context.fillText('entity', xDefaultEntity + textOffset, middle);
    // default connector
    context.fillStyle = theme.gecko.connectorColor;
    context.fillRect(xDefaultConnector, middle - 1, side, 2);
    context.fillStyle = textColor;
    context.fillText('link', xDefaultConnector + textOffset, middle);
    // default connector finemapping
    context.fillStyle = theme.gecko.finemappingConnectorColor;
    context.fillRect(xDefaultConnectorFinemapping, middle - 1, side, 2);
    context.fillStyle = textColor;
    context.fillText(
      'link (finemapping)',
      xDefaultConnectorFinemapping + textOffset,
      middle
    );

    // selected entity
    context.fillStyle = theme.gecko.colorSelected;
    context.fillRect(xSelectedEntity, top, side, side);
    context.fillStyle = textColor;
    context.fillText('entity', xSelectedEntity + textOffset, middle);

    // chained entity
    context.fillStyle = theme.gecko.colorChained;
    context.fillRect(xChainedEntity, top, side, side);
    context.fillStyle = textColor;
    context.fillText('entity', xChainedEntity + textOffset, middle);
    // chained connector
    context.fillStyle = theme.gecko.connectorColorChained;
    context.fillRect(xChainedConnector, middle - 1, side, 2);
    context.fillStyle = textColor;
    context.fillText('link', xChainedConnector + textOffset, middle);
    // chained connector finemapping
    context.fillStyle = theme.gecko.finemappingConnectorColorChained;
    context.fillRect(xChainedConnectorFinemapping, middle - 1, side, 2);
    context.fillStyle = textColor;
    context.fillText(
      'link (finemapping)',
      xChainedConnectorFinemapping + textOffset,
      middle
    );

    // labels
    context.textAlign = 'center';
    context.font = 'bold 12px sans-serif';
    context.fillText('unselected', xDefaultConnector + textOffset * 2, label);
    context.fillText('selected', xSelectedEntity + textOffset * 2, label);
    context.fillText('connected', xChainedConnector + textOffset * 2, label);

    context.restore();
  }
  _renderGenes(
    context,
    hiddenContext,
    scaleX,
    track,
    data,
    noSelectedEntities,
    showGeneVerticals
  ) {
    context.save();
    context.translate(0, track.top + GENE_TRACK_PADDING);
    hiddenContext.save();
    hiddenContext.translate(0, track.top + GENE_TRACK_PADDING);

    // verticals
    // const verticals =
    //   noSelectedEntities || showGeneVerticals
    //     ? data
    //     : data.filter(d => d.chained);
    const verticals = data.filter(d => d.chained);
    verticals.forEach(d => {
      context.strokeStyle = color(d, noSelectedEntities);
      context.beginPath();
      context.moveTo(scaleX(d.tss), d.slotIndex * GENE_SLOT_HEIGHT);
      context.lineTo(scaleX(d.tss), track.height - GENE_TRACK_PADDING);
      context.stroke();
    });

    // genes
    data.forEach(d => {
      const label = d.start === d.tss ? `${d.symbol}>` : `<${d.symbol}`;
      const textWidth = context.measureText(label).width;

      const backdropX = scaleX(d.start) - GENE_BACKDROP_PADDING;
      const backdropY =
        d.slotIndex * GENE_SLOT_HEIGHT +
        GENE_TRANSCRIPT_OFFSET -
        GENE_BACKDROP_PADDING;
      const backdropWidth =
        Math.max(textWidth, scaleX(d.end) - scaleX(d.start)) +
        GENE_BACKDROP_PADDING * 2;
      const backdropHeight =
        GENE_TRANSCRIPT_HEIGHT + CHAR_HEIGHT + GENE_BACKDROP_PADDING * 2;
      const spitY =
        d.slotIndex * GENE_SLOT_HEIGHT +
        GENE_TRANSCRIPT_OFFSET +
        GENE_TRANSCRIPT_HEIGHT / 2;

      // picker
      hiddenContext.fillStyle = d.hiddenColor;
      hiddenContext.fillRect(
        backdropX,
        backdropY,
        backdropWidth,
        backdropHeight
      );

      // backdrop
      context.fillStyle = backgroundColor(d, noSelectedEntities);
      context.strokeStyle = color(d, noSelectedEntities);
      context.fillRect(backdropX, backdropY, backdropWidth, backdropHeight);
      context.strokeRect(backdropX, backdropY, backdropWidth, backdropHeight);

      // spit
      context.beginPath();
      context.moveTo(scaleX(d.start), spitY);
      context.lineTo(scaleX(d.end), spitY);
      context.stroke();

      // exons
      d.exons.forEach(e => {
        const exonX = scaleX(e[[0]]);
        const exonY = d.slotIndex * GENE_SLOT_HEIGHT + GENE_TRANSCRIPT_OFFSET;
        const exonWidth = scaleX(e[[1]]) - exonX;
        const exonHeight = GENE_TRANSCRIPT_HEIGHT;
        context.fillRect(exonX, exonY, exonWidth, exonHeight);
        context.strokeRect(exonX, exonY, exonWidth, exonHeight);
      });

      // label
      const labelX = scaleX(d.start);
      const labelY =
        d.slotIndex * GENE_SLOT_HEIGHT +
        GENE_TRANSCRIPT_OFFSET * 2 +
        GENE_TRANSCRIPT_HEIGHT;
      context.textBaseline = 'hanging';
      context.fillStyle = color(d, noSelectedEntities);
      context.fillText(label, labelX, labelY);
    });

    context.restore();
    hiddenContext.restore();
  }
  _generateHiddenColors(data) {
    const {
      genes,
      tagVariantBlocks,
      indexVariants,
      studies,
      geneIndexVariantStudies,
    } = data;
    const colorMap = {};
    const genesWithHiddenColor = genes.map((d, i) => {
      const color = this._hiddenColor(i, 'gene');
      colorMap[color] = d;
      return { ...d, hiddenColor: color };
    });
    const tagVariantBlocksWithHiddenColor = tagVariantBlocks.map((d, i) => {
      const color = this._hiddenColor(i, 'tagVariantBlock');
      colorMap[color] = d;
      return { ...d, hiddenColor: color };
    });
    const indexVariantsWithHiddenColor = indexVariants.map((d, i) => {
      const color = this._hiddenColor(i, 'indexVariant');
      colorMap[color] = d;
      return { ...d, hiddenColor: color };
    });
    const studiesWithHiddenColor = studies.map((d, i) => {
      const color = this._hiddenColor(i, 'study');
      colorMap[color] = d;
      return { ...d, hiddenColor: color };
    });
    return {
      colorMap,
      genes: genesWithHiddenColor,
      tagVariantBlocks: tagVariantBlocksWithHiddenColor,
      indexVariants: indexVariantsWithHiddenColor,
      studies: studiesWithHiddenColor,
      geneIndexVariantStudies,
    };
  }
  _hiddenColor(entityId, type) {
    const typeId = HIDDEN_TYPE_MAP[type];
    const r = (typeId << 4) + (Math.floor(entityId / 65536) % 256);
    const g = Math.floor(entityId / 256) % 256;
    const b = entityId % 256;
    return `rgb(${r},${g},${b},255)`;
  }
  _renderTagVariantBlocks(
    context,
    hiddenContext,
    scaleX,
    track,
    data,
    noSelectedEntities
  ) {
    context.save();
    hiddenContext.save();

    // picker
    hiddenContext.translate(0, track.top);
    data.forEach(d => {
      const s = Math.round(scaleX(d.tagVariantsStart));
      const e = Math.round(scaleX(d.tagVariantsEnd));
      const isThin = e - s < 2;
      hiddenContext.fillStyle = d.hiddenColor;
      hiddenContext.fillRect(
        isThin ? s - 1 : s,
        (0.5 + d.slotIndex) * TAG_VARIANT_BLOCK_SLOT_HEIGHT -
          0.5 * VARIANT_TRACK_HEIGHT,
        isThin ? 2 : e - s,
        VARIANT_TRACK_HEIGHT
      );
    });

    // boundaries
    context.fillStyle = theme.track.background;
    context.translate(0, track.top);
    context.fillRect(0, 0, scaleX.range()[1] - scaleX.range()[0], 1);
    context.fillRect(
      0,
      track.height - 1,
      scaleX.range()[1] - scaleX.range()[0],
      1
    );

    // tag variants
    context.lineWidth = 2;
    data.forEach(d => {
      const s = Math.round(scaleX(d.tagVariantsStart));
      const e = Math.round(scaleX(d.tagVariantsEnd));
      const isThin = e - s < 2;
      context.fillStyle = tagVariantBlockColor(d, noSelectedEntities); // color(d, noSelectedEntities);
      context.fillRect(
        isThin ? s - 1 : s,
        (0.5 + d.slotIndex) * TAG_VARIANT_BLOCK_SLOT_HEIGHT -
          0.5 * VARIANT_TRACK_HEIGHT,
        isThin ? 2 : e - s,
        VARIANT_TRACK_HEIGHT
      );
    });

    context.restore();
    hiddenContext.restore();
  }
  _renderIndexVariants(
    context,
    hiddenContext,
    scaleX,
    track,
    data,
    noSelectedEntities
  ) {
    context.save();
    hiddenContext.save();

    // picker
    hiddenContext.translate(0, track.top);
    data.forEach(d => {
      hiddenContext.fillStyle = d.hiddenColor;
      hiddenContext.fillRect(
        Math.round(scaleX(d.position)) - 1,
        0,
        2,
        Math.round(track.height)
      );
    });

    // backdrop
    context.fillStyle = theme.track.background;
    context.translate(0, track.top);
    context.fillRect(0, 0, scaleX.range()[1] - scaleX.range()[0], track.height);

    // index variants
    context.lineWidth = 2;
    data.forEach(d => {
      context.strokeStyle = color(d, noSelectedEntities);
      context.beginPath();
      context.moveTo(scaleX(d.position), 0);
      context.lineTo(scaleX(d.position), track.height);
      context.stroke();
    });

    context.restore();
    hiddenContext.restore();
  }
  _renderStudies(
    context,
    hiddenContext,
    scaleX,
    scaleY,
    track,
    data,
    noSelectedEntities
  ) {
    context.save();
    context.translate(0, track.top);
    hiddenContext.save();
    hiddenContext.translate(0, track.top);

    // verticals
    data.forEach(d => {
      context.strokeStyle = color(d, noSelectedEntities);
      context.beginPath();
      context.moveTo(scaleX(d.studyId), 0);
      context.lineTo(scaleX(d.studyId), scaleY(d.studyId));
      context.stroke();
    });

    // studies
    context.textBaseline = 'hanging';
    context.textAlign = 'center';
    data.forEach(d => {
      const label =
        d.traitReported +
        (d.pubAuthor && d.pubDate
          ? ` (${d.pubAuthor} ${new Date(d.pubDate).getFullYear()})`
          : '');
      const { lineArray: labelLines, width: textWidth } = this._wrapText(
        context,
        label,
        STUDY_TEXT_MAX_WIDTH - GENE_BACKDROP_PADDING * 4
      );
      const textHeight = labelLines.length * CHAR_HEIGHT;

      const backdropX =
        scaleX(d.studyId) - textWidth / 2 - GENE_BACKDROP_PADDING;
      const backdropY = scaleY(d.studyId) - GENE_BACKDROP_PADDING;
      const backdropWidth = textWidth + GENE_BACKDROP_PADDING * 2;
      const backdropHeight = textHeight + GENE_BACKDROP_PADDING * 2;

      // picker
      hiddenContext.fillStyle = d.hiddenColor;
      hiddenContext.fillRect(
        Math.round(backdropX),
        Math.round(backdropY),
        Math.round(backdropWidth),
        Math.round(backdropHeight)
      );

      // backdrop
      context.fillStyle = backgroundColor(d, noSelectedEntities);
      context.strokeStyle = color(d, noSelectedEntities);
      // context.fillStyle = 'white';
      // context.strokeStyle = theme.line.color;
      context.fillRect(backdropX, backdropY, backdropWidth, backdropHeight);
      context.strokeRect(backdropX, backdropY, backdropWidth, backdropHeight);

      // label
      const labelX = scaleX(d.studyId);
      const labelY = scaleY(d.studyId);
      context.textBaseline = 'hanging';
      context.font = '10px sans-serif';
      context.fillStyle = color(d, noSelectedEntities);
      // context.fillStyle = theme.line.color;
      labelLines.forEach((l, i) => {
        context.fillText(l, labelX, labelY + i * CHAR_HEIGHT);
      });

      // circle
      context.fillStyle = 'white';
      context.strokeStyle = color(d, noSelectedEntities);
      context.beginPath();
      context.arc(scaleX(d.studyId), backdropY, 3, 0, 2 * Math.PI);
      context.fill();
      context.stroke();
    });

    context.restore();
    hiddenContext.restore();
  }
  _renderGeneIndexVariantStudies(
    context,
    scaleX,
    scaleStudyX,
    gTvTrack,
    tvIvTrack,
    ivSTrack,
    data,
    noSelectedEntities
  ) {
    context.save();

    data.forEach(d => {
      context.globalAlpha = 0.3;

      // gene - tagVariantBlock
      {
        const topX = scaleX(d.geneTss);
        const topY = gTvTrack.top;
        const bottomStartX = scaleX(d.tagVariantsStart);
        const bottomEndX = scaleX(d.tagVariantsEnd);
        const isThin = bottomEndX - bottomStartX < 2;
        const bottomY = gTvTrack.bottom;
        const controlY = (bottomY + topY) / 2;
        context.fillStyle = connectorColor(d, noSelectedEntities);
        context.beginPath();
        context.moveTo(topX + 1, topY);
        context.bezierCurveTo(
          topX + 1,
          controlY,
          isThin ? bottomEndX + 1 : bottomEndX,
          controlY,
          isThin ? bottomEndX + 1 : bottomEndX,
          bottomY
        );
        context.lineTo(isThin ? bottomStartX - 1 : bottomStartX, bottomY);
        context.bezierCurveTo(
          isThin ? bottomStartX - 1 : bottomStartX,
          controlY,
          topX - 1,
          controlY,
          topX - 1,
          topY
        );
        context.closePath();
        context.fill();
      }

      // tagVariantBlock - indexVariant
      {
        const topStartX = scaleX(d.tagVariantsStart);
        const topEndX = scaleX(d.tagVariantsEnd);
        const isThin = topEndX - topStartX < 2;
        const topY = tvIvTrack.top;
        const bottomX = scaleX(d.indexVariantPosition);
        const bottomY = tvIvTrack.bottom;
        const controlY = (bottomY + topY) / 2;
        context.fillStyle = connectorColor(d, noSelectedEntities);
        context.beginPath();
        context.moveTo(isThin ? topEndX + 1 : topEndX, topY);
        context.bezierCurveTo(
          isThin ? topEndX + 1 : topEndX,
          controlY,
          bottomX + 1,
          controlY,
          bottomX + 1,
          bottomY
        );
        context.lineTo(bottomX - 1, bottomY);
        context.bezierCurveTo(
          bottomX - 1,
          controlY,
          isThin ? topStartX - 1 : topStartX,
          controlY,
          isThin ? topStartX - 1 : topStartX,
          topY
        );
        context.closePath();
        context.fill();
      }

      context.globalAlpha = 1;

      // indexVariant - study
      {
        const ivSTopX = scaleX(d.indexVariantPosition);
        const ivSTopY = ivSTrack.top;
        const ivSBottomX = scaleStudyX(d.studyId);
        const ivSBottomY = ivSTrack.bottom;
        const ivSControlY = (ivSBottomY + ivSTopY) / 2;
        context.strokeStyle = connectorColor(d, noSelectedEntities);
        context.beginPath();
        context.moveTo(ivSTopX, ivSTopY);
        context.bezierCurveTo(
          ivSTopX,
          ivSControlY,
          ivSBottomX,
          ivSControlY,
          ivSBottomX,
          ivSBottomY
        );
        context.stroke();
      }
    });

    context.restore();
  }
  _geneSlots(genes, scale) {
    const sortedGenes = _.sortBy(genes.slice(), d => d.start);
    const canvas = this.canvasRef;
    const context = canvas.getContext('2d');

    let slotCount = 0;
    const slots = [];
    const genesWithSlots = [];
    const endOfGene = gene => {
      const transcriptLength = scale(gene.end) - scale(gene.start);
      const labelLength = context.measureText(gene.symbol + '>').width;
      return transcriptLength > labelLength
        ? scale.invert(scale(gene.end) + GENE_BACKDROP_PADDING * 3)
        : scale.invert(
            scale(gene.start) + labelLength + GENE_BACKDROP_PADDING * 3
          );
    };
    sortedGenes.forEach(gene => {
      const sortedSlots = _.sortBy(slots, d => d.index);
      const suitableSlots = sortedSlots.filter(slot => gene.start > slot.end);
      if (suitableSlots.length > 0) {
        // store in slots
        suitableSlots[0].genes.push(gene);

        // update slot end
        suitableSlots[0].end = endOfGene(gene);

        // store in gene list with slot index
        genesWithSlots.push({ ...gene, slotIndex: suitableSlots[0].index });
      } else {
        // store in slots
        const newSlot = {
          genes: [gene],
          end: endOfGene(gene),
          index: slotCount++,
        };
        slots.push(newSlot);

        // store in gene list with slot index
        genesWithSlots.push({ ...gene, slotIndex: newSlot.index });
      }
    });

    return { slots, genesWithSlots };
  }
  _tagVariantBlocksSlots(tagVariantBlocks, scale) {
    const sortedTagVariantBlocks = tagVariantBlocks
      .slice()
      .sort(function(a, b) {
        return a.tagVariantsStart - b.tagVariantsStart;
      });

    let slotCount = 0;
    const slots = [];
    const tagVariantBlocksWithSlots = [];
    sortedTagVariantBlocks.forEach(tagVariantBlock => {
      const suitableSlots = slots.filter(
        slot => scale(tagVariantBlock.tagVariantsStart) > scale(slot.end)
      );
      if (suitableSlots.length > 0) {
        // store in slots
        suitableSlots[0].tagVariantBlocks.push(tagVariantBlock);
        suitableSlots[0].end = tagVariantBlock.tagVariantsEnd;

        // store in gene list with slot index
        tagVariantBlocksWithSlots.push({
          ...tagVariantBlock,
          slotIndex: suitableSlots[0].index,
        });
      } else {
        // store in slots
        const newSlot = {
          tagVariantBlocks: [tagVariantBlock],
          end: tagVariantBlock.tagVariantsEnd,
          index: slotCount++,
        };
        slots.push(newSlot);

        // store in gene list with slot index
        tagVariantBlocksWithSlots.push({
          ...tagVariantBlock,
          slotIndex: newSlot.index,
        });
      }
    });

    return { slots, tagVariantBlocksWithSlots };
  }
  _studySlotCount(studies, width) {
    const studiesPerSlot = Math.floor(width / STUDY_TEXT_MAX_WIDTH) - 1;
    const slotCount = Math.ceil(studies.length / studiesPerSlot);
    return slotCount;
  }
  _studiesWithWrappedLabels(studies, context) {
    const studiesWithWrappedLabels = studies.map(d => {
      const label =
        d.traitReported +
        (d.pubAuthor && d.pubDate
          ? ` (${d.pubAuthor} ${new Date(d.pubDate).getFullYear()})`
          : '');
      const { lineArray, width } = this._wrapText(
        context,
        label,
        STUDY_TEXT_MAX_WIDTH - GENE_BACKDROP_PADDING * 4
      );
      return {
        ...d,
        wrappedLineArray: lineArray,
        wrappedLineWidth: width,
      };
    });
    return studiesWithWrappedLabels;
  }
  _studyScaleX(studies, width) {
    const domain = _.sortBy(studies.slice(), 'meanIndexVariantPosition').map(
      d => d.studyId
    );
    const rangeX = [STUDY_TEXT_MAX_WIDTH / 2, width - STUDY_TEXT_MAX_WIDTH / 2];
    const scaleStudyX = d3
      .scalePoint()
      .domain(domain)
      .range(rangeX);
    return scaleStudyX;
  }
  _studyScaleY(studies, width) {
    const studiesPerSlot = Math.floor(width / STUDY_TEXT_MAX_WIDTH) - 1;
    const slotCount = Math.ceil(studies.length / studiesPerSlot);
    const domain = _.sortBy(studies.slice(), 'meanIndexVariantPosition').map(
      (d, i) => ({
        ...d,
        slotIndex: i % slotCount,
      })
    );
    const slots = _.groupBy(domain, d => d.slotIndex);
    const slotHeights = {};
    const slotHeightsCumulative = {};
    const studiesWithSlots = {};
    Object.keys(slots).forEach(s => {
      const lineHeightsForSlot = slots[s].map(d => d.wrappedLineArray.length);
      slotHeights[s] = _.max(lineHeightsForSlot);
      slotHeightsCumulative[s] =
        (s > 0 ? slotHeightsCumulative[s - 1] : 0) + slotHeights[s];
      slots[s].forEach(d => {
        studiesWithSlots[d.studyId] = d;
      });
    });

    const top = GENE_TRACK_PADDING + ENTITY_WIDTH;
    const slotIndices = Object.keys(slots);
    const maxSlot = slotIndices[slotIndices.length - 1];
    const trackHeight =
      top +
      GENE_TRACK_PADDING +
      maxSlot * GENE_BACKDROP_PADDING * 6 +
      slotHeightsCumulative[maxSlot] * CHAR_HEIGHT;
    const rangeY = domain.map(d => {
      const s = d.slotIndex;
      return (
        top +
        s * GENE_BACKDROP_PADDING * 6 +
        (slotHeightsCumulative[s] - slotHeights[s]) * CHAR_HEIGHT
      );
    });

    const scaleStudyY = d3
      .scaleOrdinal()
      .domain(domain.map(d => d.studyId))
      .range(rangeY);

    return { scaleStudyY, trackHeight };
  }
  _studyScales(studies, width, trackHeight) {
    const studiesPerSlot = Math.floor(width / STUDY_TEXT_MAX_WIDTH) - 1;
    const slotCount = Math.ceil(studies.length / studiesPerSlot);
    // const domain = _.sortBy(studies.slice(), 'traitReported').map(
    //   d => d.studyId
    // );
    const domain = _.sortBy(studies.slice(), 'meanIndexVariantPosition').map(
      d => d.studyId
    );
    const rangeX = [STUDY_TEXT_MAX_WIDTH / 2, width - STUDY_TEXT_MAX_WIDTH / 2];
    const rangeY = domain.map((d, i) => {
      const s = GENE_TRACK_PADDING + ENTITY_WIDTH;
      const e = trackHeight - 2 * GENE_TRACK_PADDING;
      return s + ((e - s) * (i % slotCount)) / slotCount;
    });
    const scaleStudyX = d3
      .scalePoint()
      .domain(domain)
      .range(rangeX);
    const scaleStudyY = d3
      .scaleOrdinal()
      .domain(domain)
      .range(rangeY);

    return { scaleStudyX, scaleStudyY };
  }
  _trackConfig(geneSlotCount, tagVariantBlockSlotCount, studyTrackHeight) {
    const geneTrackHeight =
      geneSlotCount * GENE_SLOT_HEIGHT + 2 * GENE_TRACK_PADDING;
    const genes = {
      top: LEGEND_HEIGHT,
      bottom: geneTrackHeight + LEGEND_HEIGHT,
      height: geneTrackHeight,
    };
    const geneTagVariants = {
      top: genes.bottom,
      bottom: genes.bottom + CONNECTOR_TRACK_HEIGHT,
      height: CONNECTOR_TRACK_HEIGHT,
    };
    const tagVariantBlockTrackHeight =
      tagVariantBlockSlotCount * TAG_VARIANT_BLOCK_SLOT_HEIGHT;
    const tagVariantBlocks = {
      top: geneTagVariants.bottom,
      bottom: geneTagVariants.bottom + tagVariantBlockTrackHeight,
      height: tagVariantBlockTrackHeight,
    };
    const tagVariantIndexVariants = {
      top: tagVariantBlocks.bottom,
      bottom: tagVariantBlocks.bottom + CONNECTOR_TRACK_HEIGHT,
      height: CONNECTOR_TRACK_HEIGHT,
    };
    const indexVariants = {
      top: tagVariantIndexVariants.bottom,
      bottom: tagVariantIndexVariants.bottom + VARIANT_TRACK_HEIGHT,
      height: VARIANT_TRACK_HEIGHT,
    };
    const indexVariantStudies = {
      top: indexVariants.bottom,
      bottom: indexVariants.bottom + CONNECTOR_TRACK_HEIGHT,
      height: CONNECTOR_TRACK_HEIGHT,
    };
    // const studyTrackHeight =
    //   (studySlotCount > 0
    //     ? studySlotCount * STUDY_SLOT_HEIGHT
    //     : STUDY_SLOT_HEIGHT) +
    //   2 * GENE_TRACK_PADDING;
    const studies = {
      top: indexVariantStudies.bottom,
      bottom: indexVariantStudies.bottom + studyTrackHeight,
      height: studyTrackHeight,
    };
    return {
      genes,
      geneTagVariants,
      tagVariantBlocks,
      tagVariantIndexVariants,
      indexVariants,
      indexVariantStudies,
      studies,
      height: studies.bottom,
    };
  }
  _wrapText(context, text, maxWidth, textStyle = '10px sans-serif') {
    if (textStyle) {
      context.font = textStyle;
    }
    const { lines, width } = wrapText(
      text,
      maxWidth,
      str => context.measureText(str).width
    );
    return { lineArray: lines, width };
  }
}

export default withContentRect('bounds')(Gecko);
