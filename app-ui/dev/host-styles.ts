/**
 * The style variables a host hands the view, as Claude sends them.
 *
 * Every value below is transcribed from Claude's published design-guidelines
 * table, not derived. An earlier version of this file was reconstructed from
 * secondary sources and got the border, ring and shadow families wrong along
 * with five typography tokens — which meant the preview was certifying a
 * design in colours Claude does not use.
 *
 * A host publishes its design tokens through `hostContext.styles.variables`,
 * and `applyHostStyleVariables()` writes them as inline custom properties on
 * `<html>`. The viewer is meant to be built entirely out of these, so a
 * preview that invents its own palette would certify a design that has never
 * been seen in the colours it will actually ship in.
 *
 * Two sets, because the interesting failures are asymmetric: a design tuned in
 * dark often has unreadable secondary text in light, and a hairline that reads
 * as a hairline on #faf9f5 disappears on #262624.
 *
 * The harness can also send *no* variables at all. That is not a degenerate
 * case to be tolerated — hosts may send any subset — so it is a first-class
 * toggle, and it is the check that proves the viewer's `:root` fallbacks are
 * coherent as a set rather than merely present.
 */

import type { McpUiStyles } from '@modelcontextprotocol/ext-apps';

/** Tokens whose value does not depend on the theme. */
const SHARED = {
  '--font-sans': 'Anthropic Sans, sans-serif',
  '--font-mono': 'ui-monospace, monospace',

  '--font-weight-normal': '400',
  '--font-weight-medium': '500',
  '--font-weight-semibold': '600',
  '--font-weight-bold': '700',

  '--font-text-xs-size': '12px',
  '--font-text-sm-size': '14px',
  '--font-text-md-size': '16px',
  '--font-text-lg-size': '20px',
  '--font-text-xs-line-height': '1.4',
  '--font-text-sm-line-height': '1.4',
  '--font-text-md-line-height': '1.4',
  '--font-text-lg-line-height': '1.25',

  '--font-heading-xs-size': '12px',
  '--font-heading-sm-size': '14px',
  '--font-heading-md-size': '16px',
  '--font-heading-lg-size': '20px',
  '--font-heading-xl-size': '24px',
  '--font-heading-2xl-size': '28px',
  '--font-heading-3xl-size': '36px',
  '--font-heading-xs-line-height': '1.4',
  '--font-heading-sm-line-height': '1.4',
  '--font-heading-md-line-height': '1.4',
  '--font-heading-lg-line-height': '1.25',
  '--font-heading-xl-line-height': '1.25',
  '--font-heading-2xl-line-height': '1.1',
  '--font-heading-3xl-line-height': '1',

  '--border-radius-xs': '4px',
  '--border-radius-sm': '6px',
  '--border-radius-md': '8px',
  '--border-radius-lg': '10px',
  '--border-radius-xl': '12px',
  '--border-radius-full': '9999px',
  '--border-width-regular': '0.5px',
} satisfies Partial<McpUiStyles>;

/** Claude's light theme. */
export const LIGHT: Partial<McpUiStyles> = {
  ...SHARED,
  '--color-background-primary': '#FFFFFF',
  '--color-background-secondary': '#F5F4ED',
  '--color-background-tertiary': '#FAF9F5',
  '--color-background-inverse': '#141413',
  '--color-background-ghost': 'rgb(255 255 255 / 0)',
  '--color-background-info': '#D6E4F6',
  '--color-background-danger': '#F7ECEC',
  '--color-background-success': '#E9F1DC',
  '--color-background-warning': '#F6EEDF',
  '--color-background-disabled': 'rgb(255 255 255 / .5)',

  '--color-text-primary': '#141413',
  '--color-text-secondary': '#3D3D3A',
  '--color-text-tertiary': '#73726C',
  '--color-text-inverse': '#FFFFFF',
  '--color-text-ghost': 'rgb(115 114 108 / .5)',
  '--color-text-info': '#3266AD',
  '--color-text-danger': '#7F2C28',
  '--color-text-success': '#265B19',
  '--color-text-warning': '#5A4815',
  '--color-text-disabled': 'rgb(20 20 19 / .5)',

  '--color-border-primary': 'rgb(31 30 29 / .4)',
  '--color-border-secondary': 'rgb(31 30 29 / .3)',
  '--color-border-tertiary': 'rgb(31 30 29 / .15)',
  '--color-border-inverse': 'rgb(255 255 255 / .3)',
  '--color-border-ghost': 'rgb(31 30 29 / 0)',
  '--color-border-info': '#4682D5',
  '--color-border-danger': '#A73D39',
  '--color-border-success': '#437426',
  '--color-border-warning': '#805C1F',
  '--color-border-disabled': 'rgb(31 30 29 / .1)',

  '--color-ring-primary': 'rgb(20 20 19 / .7)',
  '--color-ring-secondary': 'rgb(61 61 58 / .7)',
  '--color-ring-inverse': 'rgb(255 255 255 / .7)',
  '--color-ring-info': 'rgb(50 102 173 / .5)',
  '--color-ring-danger': 'rgb(167 61 57 / .5)',
  '--color-ring-success': 'rgb(67 116 38 / .5)',
  '--color-ring-warning': 'rgb(128 92 31 / .5)',
  '--shadow-hairline': '0 1px 2px 0 rgb(0 0 0 / .05)',
  '--shadow-sm': '0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1)',
  '--shadow-md': '0 4px 6px -1px rgb(0 0 0 / .1), 0 2px 4px -2px rgb(0 0 0 / .1)',
  '--shadow-lg': '0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1)',
};

/** Claude's dark theme. */
export const DARK: Partial<McpUiStyles> = {
  ...SHARED,
  '--color-background-primary': '#30302E',
  '--color-background-secondary': '#262624',
  '--color-background-tertiary': '#141413',
  '--color-background-inverse': '#FAF9F5',
  '--color-background-ghost': 'rgb(48 48 46 / 0)',
  '--color-background-info': '#253E5F',
  '--color-background-danger': '#602A28',
  '--color-background-success': '#1B4614',
  '--color-background-warning': '#483A0F',
  '--color-background-disabled': 'rgb(48 48 46 / .5)',

  '--color-text-primary': '#FAF9F5',
  '--color-text-secondary': '#C2C0B6',
  '--color-text-tertiary': '#9C9A92',
  '--color-text-inverse': '#141413',
  '--color-text-ghost': 'rgb(156 154 146 / .5)',
  '--color-text-info': '#80AADD',
  '--color-text-danger': '#EE8884',
  '--color-text-success': '#7AB948',
  '--color-text-warning': '#D1A041',
  '--color-text-disabled': 'rgb(250 249 245 / .5)',

  '--color-border-primary': 'rgb(222 220 209 / .4)',
  '--color-border-secondary': 'rgb(222 220 209 / .3)',
  '--color-border-tertiary': 'rgb(222 220 209 / .15)',
  '--color-border-inverse': 'rgb(20 20 19 / .15)',
  '--color-border-ghost': 'rgb(222 220 209 / 0)',
  '--color-border-info': '#4682D5',
  '--color-border-danger': '#CD5C58',
  '--color-border-success': '#599130',
  '--color-border-warning': '#A87829',
  '--color-border-disabled': 'rgb(222 220 209 / .1)',

  '--color-ring-primary': 'rgb(250 249 245 / .7)',
  '--color-ring-secondary': 'rgb(194 192 182 / .7)',
  '--color-ring-inverse': 'rgb(20 20 19 / .7)',
  '--color-ring-info': 'rgb(128 170 221 / .5)',
  '--color-ring-danger': 'rgb(205 92 88 / .5)',
  '--color-ring-success': 'rgb(89 145 48 / .5)',
  '--color-ring-warning': 'rgb(168 120 41 / .5)',
  '--shadow-hairline': '0 1px 2px 0 rgb(0 0 0 / .05)',
  '--shadow-sm': '0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1)',
  '--shadow-md': '0 4px 6px -1px rgb(0 0 0 / .1), 0 2px 4px -2px rgb(0 0 0 / .1)',
  '--shadow-lg': '0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1)',
};

/**
 * The surface the host paints *behind* the iframe.
 *
 * Not part of `McpUiStyles` — the view never receives it. It is here because
 * the viewer's first rule is that it paints no background of its own, and that
 * rule can only be judged against the colour it will actually sit on.
 */
export const HOST_CANVAS = { light: '#FFFFFF', dark: '#30302E' } as const;
