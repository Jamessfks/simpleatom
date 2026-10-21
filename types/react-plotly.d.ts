/// <reference types="@types/plotly.js" />

declare module "react-plotly.js" {
  import { Component } from "react";

  interface Figure {
    data: Plotly.Data[];
    layout: Partial<Plotly.Layout>;
  }

  interface PlotParams {
    data: Plotly.Data[];
    layout?: Partial<Plotly.Layout>;
    config?: Partial<Plotly.Config>;
    style?: React.CSSProperties;
    className?: string;
    useResizeHandler?: boolean;
    onInitialized?: (figure: Readonly<Figure>, graphDiv: HTMLElement) => void;
    onUpdate?: (figure: Readonly<Figure>, graphDiv: HTMLElement) => void;
  }

  export default class Plot extends Component<PlotParams> {}
}

declare module "plotly.js-dist-min" {
  export = Plotly;
}
