export default function include_photoswipe(
	gallery_selector = ".my-gallery"
) {
	return /* HTML */ `
		<script>
			window.addEventListener("load", () =>
				initPhotoSwipeFromDOM("${gallery_selector}")
			);
		</script>`;
}
