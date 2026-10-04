type Props = { width: number; height: number; className?: string };

/** The ZeroBox mark (same paths as assets/logo-mark.svg), styled by .lg-* classes. */
export function Logo({ width, height, className }: Props) {
  return (
    <svg viewBox="362 328 530 395" width={width} height={height} aria-hidden="true" focusable="false" className={className}>
      <path
        className="lg-o"
        d="M379 377A32 32 0 0 1 411 345H489Q507 345 518 359L551 400Q562 414 580 414H674Q692 414 703 400L736 359Q747 345 765 345H843A32 32 0 0 1 875 377V674A32 32 0 0 1 843 706H411A32 32 0 0 1 379 674Z"
      />
      <path className="lg-c" d="M443 474L544 537V556L443 618V580L499 546L443 512Z" />
      <rect className="lg-c" x="559" y="598" width="105" height="35" />
      <path
        className="lg-z"
        d="M755 471H762A58 58 0 0 1 820 529V580A58 58 0 0 1 762 638H755A58 58 0 0 1 697 580V529A58 58 0 0 1 755 471Z M758.5 504H758.5A23.5 23.5 0 0 1 782 527.5V581.5A23.5 23.5 0 0 1 758.5 605H758.5A23.5 23.5 0 0 1 735 581.5V527.5A23.5 23.5 0 0 1 758.5 504Z"
      />
    </svg>
  );
}
