import type { ReactNode } from 'react';

/** Tiny line icons (24 px, currentColor) for the crops the photo AI knows. Shapes are by kind of plant; potato, tomato and rice have their own. */
export type Shape = 'leaf' | 'fruit' | 'tree' | 'berry' | 'ear' | 'leafy' | 'root' | 'pod' | 'tuber';

const D: Record<Shape, ReactNode> = {
  leaf: <path d="M5 19C5 10 11 5 19 5C19 13 14 19 5 19ZM5 19L14 10" />,
  fruit: (
    <>
      <circle cx="12" cy="14" r="6.5" />
      <path d="M12 7.5V4M12 6C14 4 16 4 17.5 5.5M9.5 8.5C10.5 7.5 13.5 7.5 14.5 8.5" />
    </>
  ),
  tree: <path d="M12 21V13M6 12C3.5 8 8 3.5 12 5C16 3.5 20.5 8 18 12C16 14.5 8 14.5 6 12ZM12 17L9 14.5M12 17L15 14.5" />,
  berry: (
    <>
      <circle cx="8.5" cy="14" r="3" />
      <circle cx="15.5" cy="14" r="3" />
      <circle cx="12" cy="9" r="3" />
      <path d="M12 6V3M12 4C14 3 16 3.5 17 4.5" />
    </>
  ),
  ear: <path d="M12 21V9M12 9C9 8 8.5 5.5 9 3.5C11.5 4 12.5 6 12 9ZM12 9C15 8 15.5 5.5 15 3.5C12.5 4 11.5 6 12 9ZM12 15C9.5 14.5 8 13 7.5 11M12 15C14.5 14.5 16 13 16.5 11M12 18C10 17.5 9 16.5 8.5 15M12 18C14 17.5 15 16.5 15.5 15" />,
  leafy: <path d="M12 20C6 20 3.5 15 5 11C7 12 9 12 10 11C9 8 10 5 12 4C14 5 15 8 14 11C15 12 17 12 19 11C20.5 15 18 20 12 20ZM12 20V10" />,
  root: <path d="M8 8H16L12.5 21H11.5ZM12 8V4M9.5 8C8.5 6 8 5 7 4.5M14.5 8C15.5 6 16 5 17 4.5M10 12H13M10.5 16H12.5" />,
  pod: (
    <>
      <path d="M4.5 17C8.5 21 19.5 13.5 19.5 5.5C12.5 7.5 4 10.5 4.5 17Z" />
      <circle cx="9.5" cy="14" r="1" />
      <circle cx="13" cy="11.5" r="1" />
      <circle cx="16" cy="9" r="1" />
    </>
  ),
  tuber: (
    <>
      <path d="M4 14C4 9.5 8 7 12.5 7.5C17.5 8 20.5 11 19.5 15C18.5 18.5 13.5 19.5 9.5 18.5C6 17.5 4 16.5 4 14Z" />
      <circle cx="9" cy="12.5" r="0.9" />
      <circle cx="14" cy="14.5" r="0.9" />
      <circle cx="15.5" cy="10.5" r="0.9" />
    </>
  ),
};

/** crop name in the model's config.json -> its icon and its words (pl.c.* in en/bn.homestory.ts). Unknown crops still show, as a leaf. */
export const CROP: Record<string, Shape> = {
  apple: 'fruit', banana: 'leaf', basil: 'leafy', bean: 'pod', 'bell pepper': 'fruit', blueberry: 'berry', broccoli: 'leafy', cabbage: 'leafy',
  carrot: 'root', cauliflower: 'leafy', celery: 'leafy', cherry: 'berry', citrus: 'fruit', coffee: 'berry', corn: 'ear', cucumber: 'fruit',
  eggplant: 'fruit', garlic: 'root', ginger: 'root', grape: 'berry', lettuce: 'leafy', maple: 'leaf', peach: 'fruit', plum: 'fruit',
  potato: 'tuber', raspberry: 'berry', rice: 'ear', soybean: 'pod', squash: 'fruit', strawberry: 'berry', tobacco: 'leaf', tomato: 'fruit', zucchini: 'fruit',
};

export function PlantIcon({ shape, size = 22 }: { shape: Shape; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {D[shape]}
    </svg>
  );
}
