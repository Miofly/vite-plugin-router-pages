import MarkdownIt from 'markdown-it';
import fs from 'fs';
import JSON5 from 'json5';
import { omit, pick } from 'lodash';
import { parse as YAMLParser } from 'yaml';
import matter from 'gray-matter';
import { importModule } from 'local-pkg';
import { extname } from 'path';
import { load } from 'cheerio';
import extractComments from 'extract-comments';
import { debug } from './utils';
// @ts-ignore
import type { SFCBlock, SFCDescriptor } from '@vue/compiler-sfc';
import type { CustomBlock, ParsedJSX, ResolvedOptions } from './types';
import type { AnyNode } from 'cheerio';
const routeJSXReg = /^[\n\s]+(route)[\n\s]+/gm;
const $ = load('');

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export const HTML_TAGS = (
  'html,body,base,head,link,meta,style,title,address,article,aside,footer,' +
  'header,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,' +
  'figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,' +
  'data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,' +
  'time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,' +
  'canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,' +
  'th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,' +
  'option,output,progress,select,textarea,details,dialog,menu,' +
  'summary,template,blockquote,iframe,tfoot'
).split(',');

// https://developer.mozilla.org/en-US/docs/Web/SVG/Element
export const SVG_TAGS = (
  'svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,' +
  'defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,' +
  'feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,' +
  'feDistanceLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,' +
  'feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,' +
  'fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,' +
  'foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,' +
  'mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,' +
  'polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,' +
  'text,textPath,title,tspan,unknown,use,view'
).split(',');

export function parseJSX(code: string): ParsedJSX[] {
  return extractComments(code)
    .slice(0, 1)
    .filter((comment: ParsedJSX) => routeJSXReg.test(comment.value) && comment.value.includes(':') && comment.loc.start.line === 1);
}

export function parseYamlComment(code: ParsedJSX[], path: string): CustomBlock {
  return code.reduce((memo, item) => {
    const { value } = item;
    const v = value.replace(routeJSXReg, '');
    debug.routeBlock(`use ${v} parser`);
    try {
      const yamlResult = YAMLParser(v);

      return {
        ...memo,
        ...yamlResult
      };
    } catch (err: any) {
      throw new Error(`Invalid YAML format of comment in ${path}\n${err.message}`);
    }
  }, {});
}

export async function parseSFC(code: string): Promise<SFCDescriptor> {
  try {
    const { parse } = (await importModule('@vue/compiler-sfc')) as typeof import('@vue/compiler-sfc');
    return (
      parse(code, {
        pad: 'space'
      }).descriptor ||
      // for @vue/compiler-sfc ^2.7
      (parse as any)({
        source: code
      })
    );
  } catch {
    throw new Error('[vite-plugin-pages] Vue3\'s "@vue/compiler-sfc" is required.');
  }
}

export function parseCustomBlock(block: SFCBlock, filePath: string, options: ResolvedOptions): any {
  const lang = block.lang ?? options.routeBlockLang;

  debug.routeBlock(`use ${lang} parser`);

  if (lang === 'json5') {
    try {
      return JSON5.parse(block.content);
    } catch (err: any) {
      throw new Error(`Invalid JSON5 format of <${block.type}> content in ${filePath}\n${err.message}`);
    }
  } else if (lang === 'json') {
    try {
      return JSON.parse(block.content);
    } catch (err: any) {
      throw new Error(`Invalid JSON format of <${block.type}> content in ${filePath}\n${err.message}`);
    }
  } else if (lang === 'yaml' || lang === 'yml') {
    try {
      return YAMLParser(block.content);
    } catch (err: any) {
      throw new Error(`Invalid YAML format of <${block.type}> content in ${filePath}\n${err.message}`);
    }
  }
}

export async function getRouteBlock(path: string, options: ResolvedOptions) {
  if (fs.existsSync(path)) {
    const content = fs.readFileSync(path, 'utf8');

    const parsedSFC = await parseSFC(content);

    let result;

    if (extname(path) === '.md') {
      const { data, content: mdContent } = matter(content);
      const { excerpt } = matter(content, {
        excerpt: true,
        excerpt_separator: '<!-- more -->'
      });

      const md = MarkdownIt({
        html: true,
        linkify: true,
        xhtmlOut: false,
        breaks: false,
        langPrefix: 'language-',
        typographer: false
      });

      if (excerpt) {
        const renderedContent = md.render(excerpt, {});
        if (renderedContent) {
          data.summary = renderedContent;
        }
      } else {
        let excerpt = '';
        const handleNode = (node: AnyNode, base: string, isCustomElement: (tagName: string) => boolean): AnyNode | null => {
          if (node.type === 'tag') {
            // toc should be dropped
            if ([node.attribs['class'], node.attribs['id']].some((item) => ['table-of-contents', 'toc'].includes(item))) return null;
  
            if (node.tagName === 'a') {
              node.attribs['target'] = '_blank';
              return node;
            }

            if (['table', 'pre'].includes(node.tagName)) return null;
            // standard tags can be returned
            if (HTML_TAGS.includes(node.tagName) || SVG_TAGS.includes(node.tagName)) {
              // remove heading id tabindex and anchor inside
              if (HEADING_TAGS.includes(node.tagName)) {
                delete node.attribs['id'];
                delete node.attribs['tabindex'];
                node.children = node.children.filter((child) => child.type !== 'tag' || child.tagName !== 'a' || child.attribs['class'] !== 'header-anchor');
              }

              // remove `v-pre` attribute
              if (node.tagName === 'code' || node.tagName === 'pre') delete node.attribs['v-pre'];

              node.children = handleNodes(node.children, base, isCustomElement);

              return node;
            }
  
            if (node.tagName === 'code') {
              console.log(node.attribs);
            }

            if (isCustomElement(node.tagName)) return node;

            // other tags will be considered as vue components and will be dropped
            return null;
          }

          return node;
        };

        const handleNodes = (nodes: AnyNode[] | null, base: string, isCustomElement: (tagName: string) => boolean): AnyNode[] =>
          Array.isArray(nodes) ? nodes.map((node) => handleNode(node, base, isCustomElement)).filter((node): node is AnyNode => node !== null) : [];

        const renderedContent = md.render(mdContent, {});

        const rootNodes = $.parseHTML(renderedContent) || [];

        const _excerptLength = data.excerptLength ?? 200;
        
        if (_excerptLength) {
          for (const node of rootNodes) {
            const resolvedNode = handleNode(node, '', (): boolean => false);
    
            if (resolvedNode) {
              excerpt += `${$.html(resolvedNode)}`;
              if (excerpt.length >= _excerptLength) break;
            }
          }
        }

        data.summary = excerpt;
      }

      result = data;
    } else {
      const blockStr = parsedSFC?.customBlocks.find((b) => {
        return b.type === 'route';
      });

      const parsedJSX = parseJSX(content);

      if (!blockStr && parsedJSX.length === 0) return;

      if (blockStr) result = parseCustomBlock(blockStr, path, options) as CustomBlock;

      if (parsedJSX.length > 0) result = parseYamlComment(parsedJSX, path) as CustomBlock;
    }

    return result;
  }
}
