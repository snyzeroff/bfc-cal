import { cn } from "@/lib/cn";

/** B-CS Finance monogram, on a white tile so it reads on any background (light, dark or brand colour). */
export function Logo({ size = 28, className }: { shortName?: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-[26%] bg-white shadow-sm ring-1 ring-black/5", className)}
    >
      <svg viewBox="-24 -41 1000 1000" width="86%" height="86%" focusable="false">
        <path fill="#D0003A" d="M 398 67 L 431 44 C 463 20, 501 17, 536 40 L 780 201 C 821 228, 843 269, 843 317 C 843 365, 825 397, 782 426 L 724 464 L 782 502 C 822 529, 843 563, 843 610 C 843 660, 821 692, 779 719 L 529 870 C 484 899, 450 900, 408 880 C 379 866, 344 839, 323 807 C 306 783, 299 756, 299 726 L 299 657 C 299 612, 321 576, 358 550 L 415 514 C 431 504, 449 506, 466 517 L 517 549 C 532 558, 532 571, 517 580 L 458 616 C 435 630, 422 649, 422 677 L 422 714 C 422 756, 462 783, 498 760 L 676 648 C 712 625, 713 592, 679 570 L 550 485 C 534 475, 534 458, 550 448 L 678 364 C 713 341, 713 300, 678 278 L 515 170 C 493 156, 477 154, 455 164 L 398 67 Z" />
        <path fill="#9670AA" d="M 138 244 L 396 68 C 425 48, 462 52, 481 83 C 502 116, 484 147, 459 164 L 190 337 C 162 355, 132 344, 117 317 C 104 292, 114 261, 138 244 Z" />
        <path fill="#9670AA" d="M 164 442 L 451 261 C 474 246, 494 247, 516 260 L 536 273 C 571 295, 571 326, 536 347 L 267 517 C 245 532, 233 552, 233 578 L 235 719 C 235 742, 222 751, 203 740 C 147 706, 110 662, 110 603 L 110 547 C 110 504, 130 464, 164 442 Z" />
      </svg>
    </span>
  );
}
