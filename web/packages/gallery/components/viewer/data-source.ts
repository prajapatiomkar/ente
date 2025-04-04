import { isDevBuild } from "ente-base/env";
import log from "ente-base/log";
import type { FileInfoExif } from "ente-gallery/components/FileInfo";
import { downloadManager } from "ente-gallery/services/download";
import { extractRawExif, parseExif } from "ente-gallery/services/exif";
import { hlsPlaylistDataForFile } from "ente-gallery/services/video";
import type { EnteFile } from "ente-media/file";
import { fileCaption } from "ente-media/file-metadata";
import { FileType } from "ente-media/file-type";
import { ensureString } from "ente-utils/ensure";

/**
 * This is a subset of the fields expected by PhotoSwipe itself (see the
 * {@link SlideData} type exported by PhotoSwipe).
 */
interface PhotoSwipeSlideData {
    /**
     * The image URL expected by PhotoSwipe.
     *
     * This is set to the URL of the image that should be shown in the image
     * viewer component provided by PhotoSwipe.
     *
     * It will be a renderable (i.e., possibly converted) object URL obtained
     * from the current "best" image we have.
     *
     * For example, if all we have is the thumbnail, then this'll be an
     * renderable object URL obtained from the thumbnail data. Then later when
     * we fetch the original image, this'll be the renderable object URL derived
     * from the original. But if it is a video, this will just be cleared.
     */
    src?: string | undefined;
    /**
     * The width (in pixels) of the {@link src} image.
     */
    width?: number | undefined;
    /**
     * The height (in pixels) of the {@link src} image.
     */
    height?: number | undefined;
    /**
     * The alt text associated with the file.
     *
     * This will be set to the file's caption. PhotoSwipe will use it as the alt
     * text when constructing img elements (if any) for this item. We will also
     * use this for displaying the visible "caption" element atop the file (both
     * images and video).
     */
    alt?: string;
    /**
     * The HTML (string) contents of the slide, if we don't wish for it to show
     * an image.
     */
    html?: string | undefined;
}

/**
 * The data returned by the flagship {@link itemDataForFile} function provided
 * by the file viewer data source module.
 *
 * This is the minimal data expected by PhotoSwipe, plus some fields we use
 * ourselves in the custom scaffolding we have around PhotoSwipe.
 */
export type ItemData = PhotoSwipeSlideData & {
    /**
     * The ID of the {@link EnteFile} whose data we are.
     */
    fileID: number;
    /**
     * The {@link EnteFile} type of the file whose data we are.
     */
    fileType: FileType;
    /**
     * The renderable object URL of the image associated with the file.
     *
     * - For images, this will be the object URL of a renderable image.
     * - For videos, this will not be defined.
     * - For live photos, this will be a renderable object URL of the image
     *   portion of the live photo.
     */
    imageURL?: string;
    /**
     * The original image associated with the file, as a Blob.
     *
     * - For images, this will be the original image itself.
     * - For live photos, this will be the image component of the live photo.
     * - For videos, this will be not be present.
     */
    originalImageBlob?: Blob;
    /**
     * The renderable object URL of the video associated with the file.
     *
     * - For images, this will not be defined.
     * - For videos, this will be the object URL of a renderable video (but only
     *   if {@link videoPlaylistURL} is not set).
     * - For live photos, this will be a renderable object URL of the video
     *   portion of the live photo.
     */
    videoURL?: string;
    /**
     * The object URL to an HLS playlist that can be used to play the video
     * associated with the file in a streaming manner.
     *
     * This will only be defined for videos for which a corresponding streamable
     * version has been created.
     *
     * Only one of {@link videoURL} or {@link videoPlaylistURL} will be set at a
     * time.
     */
    videoPlaylistURL?: string;
    /**
     * The DOM element ID of the `media-controller` element that is showing the
     * video for the current item.
     *
     * If present, this value will be used to display controls for controlling
     * the video wrapped by the media-controller.
     *
     * This is only set for videos that are streamed using HLS (i.e. videos for
     * which {@link videoPlaylistURL} has also been set).
     */
    mediaControllerID?: string;
    /**
     * `true` if we should indicate to the user that we're still fetching data
     * for this file.
     *
     * Note that this doesn't imply that the data is final. e.g. for a live
     * photo, this will be not be set after we get the original image component,
     * but the fetch for the video component might still be ongoing.
     */
    isContentLoading?: boolean;
    /**
     * This will be explicitly set to `false` when we want to disable
     * PhotoSwipe's built in image zoom.
     *
     * It is set while the thumbnail is loaded.
     */
    isContentZoomable?: boolean;
    /**
     * This will be `true` if the fetch for the file's data has failed.
     *
     * It is possible for this to be set in tandem with the content URLs also
     * being set (e.g. if we were able to use the cached thumbnail, but the
     * original file could not be fetched because of an network error).
     */
    fetchFailed?: boolean;
};

/**
 * This module stores and serves data required by our custom PhotoSwipe
 * instance, effectively acting as an in-memory cache.
 *
 * By keeping this independent of the lifetime of the PhotoSwipe instance, we
 * can reuse the same cache for multiple displays of our file viewer.
 *
 * This will be cleared on logout.
 */
class FileViewerDataSourceState {
    /**
     * Non-zero if a file viewer is currently open.
     *
     * This is a counter, but the file viewer data source has other many
     * assumptions about only a single instance of PhotoSwipe being active at a
     * time, so this could've been a boolean as well.
     */
    viewerCount = 0;
    /**
     * True if our state needs to be cleared the next time the file viewer is
     * closed.
     */
    needsReset = false;
    /**
     * The best data we have for a particular file (ID).
     */
    itemDataByFileID = new Map<number, ItemData>();
    /**
     * The latest callback registered for notifications of better data being
     * available for a particular file (ID).
     */
    needsRefreshByFileID = new Map<number, () => void>();
    /**
     * The exif data we have for a particular file (ID).
     */
    fileInfoExifByFileID = new Map<number, FileInfoExif>();
    /**
     * The latest callback registered for notifications of exif data being
     * available for a particular file (ID).
     */
    exifObserverByFileID = new Map<number, (exif: FileInfoExif) => void>();
}

/**
 * State shared by functions in this module.
 *
 * See {@link FileViewerDataSourceState}.
 */
let _state = new FileViewerDataSourceState();

const resetState = () => {
    _state = new FileViewerDataSourceState();
};

/**
 * Clear any internal state maintained by the file viewer data source.
 */
export const logoutFileViewerDataSource = resetState;

/**
 * Clear any internal state if possible. This is invoked when files have been
 * updated on remote, and those changes synced locally.
 *
 * Because we also retain callbacks, clearing existing item data when the file
 * viewer is open can lead to problematic edge cases. Thus, this function
 * behaves in two different ways:
 *
 * - If the file viewer is already open, then we enqueue a reset for when it is
 *   closed the next time.
 *
 * - Otherwise we immediately reset our state.
 *
 * See: [Note: Changes to underlying files when file viewer is open]
 */
export const resetFileViewerDataSourceOnClose = () => {
    if (_state.viewerCount) {
        _state.needsReset = true;
    } else {
        resetState();
    }
};

/**
 * Called by the file viewer whenever it is opened.
 */
export const fileViewerWillOpen = () => {
    _state.viewerCount++;
};

/**
 * Called by the file viewer whenever it has been closed.
 */
export const fileViewerDidClose = () => {
    _state.viewerCount--;
    if (_state.needsReset && _state.viewerCount == 0) {
        // Reset everything.
        resetState();
    } else {
        // Selectively clear.
        forgetFailedItems();
        forgetExif();
    }
};

/**
 * Return the best available {@link ItemData} for rendering the given
 * {@link file}.
 *
 * If an entry does not exist for a particular file, then it is lazily added on
 * demand, and updated as we keep getting better data (thumbnail, original) for
 * the file.
 *
 * At each step, we call the provided callback so that file viewer can call us
 * again to get the updated data.
 *
 * ---
 *
 * Detailed flow:
 *
 * If we already have the final data about the file, then this function will
 * return it and do nothing subsequently.
 *
 * Otherwise, it will:
 *
 * 1. Return empty slide data; PhotoSwipe will not show anything in the image
 *    area but will otherwise render UI controls properly (in most cases a
 *    cached renderable thumbnail URL will be available shortly).
 *
 * 2. Insert this empty data in its cache so that we don't enqueue multiple
 *    updates.
 *
 * Then it we start fetching data for the file.
 *
 * First it'll fetch the thumbnail. Once that is done, it'll update the data it
 * has cached, and notify the caller (using the provided callback) so it can
 * refresh the slide.
 *
 * Then it'll continue fetching the original.
 *
 * - For images and videos, this will be the single original.
 *
 * - For live photos, this will also be a two step process, first fetching the
 *   video component, then fetching the image component.
 *
 * At this point, the data for this file will be considered final, and
 * subsequent calls for the same file will return this same value unless it is
 * invalidated.
 *
 * If at any point an error occurs, we reset our cache for this file so that the
 * next time the data is requested we repeat the process instead of continuing
 * to serve the incomplete result.
 */
export const itemDataForFile = (file: EnteFile, needsRefresh: () => void) => {
    const fileID = file.id;
    const fileType = file.metadata.fileType;

    let itemData = _state.itemDataByFileID.get(fileID);

    // We assume that there is only one file viewer that is using us at a given
    // point of time. This assumption is currently valid.
    _state.needsRefreshByFileID.set(file.id, needsRefresh);

    if (!itemData) {
        itemData = { fileID, fileType, isContentLoading: true };
        _state.itemDataByFileID.set(file.id, itemData);
        void enqueueUpdates(file);
    }

    return itemData;
};

/**
 * Forget item data for the given {@link file} if its fetch had failed.
 *
 * This is called when the user moves away from a slide so that we attempt a
 * full retry when they come back the next time.
 */
export const forgetFailedItemDataForFileID = (fileID: number) => {
    if (_state.itemDataByFileID.get(fileID)?.fetchFailed) {
        _state.itemDataByFileID.delete(fileID);
    }
};

/**
 * Update the alt attribute of the {@link ItemData}, if any, associated with the
 * given {@link EnteFile}.
 *
 * @param updatedFile The file whose caption was updated.
 */
export const updateItemDataAlt = (updatedFile: EnteFile) => {
    const itemData = _state.itemDataByFileID.get(updatedFile.id);
    if (itemData) {
        itemData.alt = fileCaption(updatedFile);
    }
};

/**
 * Forget item data for the all files whose fetch had failed.
 *
 * This is called when the user closes the file viewer so that we attempt a full
 * retry when they reopen the viewer the next time.
 */
const forgetFailedItems = () =>
    [..._state.itemDataByFileID.keys()].forEach(forgetFailedItemDataForFileID);

const enqueueUpdates = async (file: EnteFile) => {
    const fileID = file.id;
    const fileType = file.metadata.fileType;

    const update = (itemData: Partial<ItemData>) => {
        // Use the file's caption as its alt text (in addition to using it as
        // the visible caption).
        const alt = fileCaption(file);

        _state.itemDataByFileID.set(file.id, {
            ...itemData,
            fileType,
            fileID,
            alt,
        });
        _state.needsRefreshByFileID.get(file.id)?.();
    };

    // Use the last best available data, but stop showing the loading indicator
    // and instead show the error indicator.
    const markFailed = () => {
        const lastData: Partial<ItemData> =
            _state.itemDataByFileID.get(file.id) ?? {};
        delete lastData.isContentLoading;
        update({ ...lastData, fetchFailed: true });
    };

    try {
        const thumbnailURL = await downloadManager.renderableThumbnailURL(file);
        // While the types don't reflect it, it is safe to use the ! (null
        // assertion) here since renderableThumbnailURL can throw but will not
        // return undefined by default.
        const thumbnailData = await withDimensionsIfPossible(
            ensureString(thumbnailURL),
        );
        update({
            ...thumbnailData,
            isContentLoading: true,
            isContentZoomable: false,
        });
    } catch (e) {
        // If we can't even get the thumbnail, then a network error is likely
        // (download manager already has retries); in particular, it cannot be a
        // format error since thumbnails are already standard JPEGs.
        //
        // Notify the user of the error. The entire process will be retried when
        // they reopen the slide later.
        //
        // See: [Note: File viewer error handling]
        log.error("Failed to fetch thumbnail", e);
        markFailed();
        return;
    }

    try {
        if (isDevBuild && process.env.NEXT_PUBLIC_ENTE_WIP_VIDEO_STREAMING) {
            if (file.metadata.fileType == FileType.video) {
                const playlistData = await hlsPlaylistDataForFile(file);
                if (playlistData) {
                    const {
                        playlistURL: videoPlaylistURL,
                        width,
                        height,
                    } = playlistData;
                    update({ videoPlaylistURL, width, height });
                    return;
                }
            }
        }

        const sourceURLs = await downloadManager.renderableSourceURLs(file);

        switch (sourceURLs.type) {
            case "image": {
                const imageURL = sourceURLs.renderableImageURL;
                const originalImageBlob = sourceURLs.originalImageBlob;
                const itemData = await withDimensionsIfPossible(imageURL);
                update({ ...itemData, imageURL, originalImageBlob });
                break;
            }

            case "video": {
                update({ videoURL: sourceURLs.playableVideoURL });
                break;
            }

            case "livePhoto": {
                // The image component of a live photo usually is an HEIC file,
                // which cannot be displayed natively by many browsers and needs
                // a conversion, which is slow on web (faster on desktop). We
                // already have both components available since they're part of
                // the same zip. And in the UI, the first (default) interaction
                // is to loop the live video.
                //
                // For these reasons, we resolve with the video first, then
                // resolve with the image.
                const videoURL = await sourceURLs.video();
                update({
                    videoURL,
                    isContentLoading: true,
                    isContentZoomable: false,
                });
                const imageURL = await sourceURLs.image();
                const originalImageBlob = sourceURLs.originalImageBlob()!;
                update({
                    ...(await withDimensionsIfPossible(imageURL)),
                    imageURL,
                    originalImageBlob,
                    videoURL,
                });
                break;
            }
        }
    } catch (e) {
        // [Note: File viewer error handling]
        //
        // Generally, file downloads will fail because of two reasons: Network
        // errors, or format errors.
        //
        // In the first case (network error), the `renderableSourceURLs` method
        // above will throw. We will show an error indicator icon in the UI, but
        // will keep showing the thumbnail.
        //
        // In the second case (format error), we'll get back a URL, but if a
        // file conversion was needed but not possible (say, it is an
        // unsupported format), we might have at our hands the original file's
        // untouched URL, that the browser might not know how to render.
        //
        // In this case we won't get into an error state here, but PhotoSwipe
        // will encounter an error when trying to render it, and it will show
        // our customized error message ("This file could not be previewed"),
        // but the user will still be able to download it.
        log.error("Failed to fetch file", e);
        markFailed();
    }
};

/**
 * Take a image URL, determine its dimensions using browser APIs if possible,
 * and return the URL and its dimensions in a form that can directly be passed
 * to PhotoSwipe as {@link ItemData}.
 *
 * If the dimensions cannot be extracted (i.e., the browser was not able to load
 * the image), then PhotoSwipe itself will also not likely be able to render it,
 * but we still return the {@link imageURL} back so that PhotoSwipe can show the
 * appropriate error when trying to render it.
 */
const withDimensionsIfPossible = (
    imageURL: string,
): Promise<Partial<ItemData>> =>
    new Promise((resolve) => {
        const image = new Image();
        image.onload = () =>
            resolve({
                src: imageURL,
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
        image.onerror = () => resolve({ src: imageURL });
        image.src = imageURL;
    });

/**
 * Return the cached Exif data for the given {@link file}.
 *
 * The shape of the returned data is such that it can directly be used by the
 * {@link FileInfo} sidebar.
 *
 * Exif extraction is not too expensive, and takes around 10-200 ms usually, so
 * this can be done preemptively. As soon as we get data for a particular item
 * as the user swipes through the file viewer, we extract its exif data using
 * {@link updateFileInfoExifIfNeeded}.
 *
 * Then if the user were to open the file info sidebar for that particular file,
 * the associated exif data will be returned by this function. Since the happy
 * path is for synchronous use in a React component, this function synchronously
 * returns the cached value (and the callback is never invoked).
 *
 * The user can open the file info sidebar before the original has been fetched,
 * so it is possible that this function gets called before
 * {@link updateFileInfoExifIfNeeded} has completed. In such cases, this
 * function will synchronously return `undefined`, and then later call the
 * provided {@link observer} once the extraction results are available.
 */
export const fileInfoExifForFile = (
    file: EnteFile,
    observer: (exifData: FileInfoExif) => void,
) => {
    const fileID = file.id;
    const exifData = _state.fileInfoExifByFileID.get(fileID);
    if (exifData) return exifData;

    _state.exifObserverByFileID.set(fileID, observer);
    return undefined;
};

/**
 * Update, if needed, the cached Exif data for with the given {@link itemData}.
 *
 * This function is expected to be called when an item is loaded as PhotoSwipe
 * content. It can be safely called multiple times - it will ignore calls until
 * the item has an associated {@link originalImageBlob}, and it will also ignore calls
 * that are made after exif data has already been extracted.
 *
 * If required, it will extract the exif data from the file, massage it to a
 * form suitable for use by {@link FileInfo}, and stash it in its caches, and
 * notify the most recent observer for that file attached via
 * {@link fileInfoExifForFile}.
 *
 * See also {@link forgetExifForItemData}.
 */
export const updateFileInfoExifIfNeeded = async (itemData: ItemData) => {
    const { fileID, fileType, originalImageBlob } = itemData;

    // We already have it available.
    if (_state.fileInfoExifByFileID.has(fileID)) return;

    const updateNotifyAndReturn = (exifData: FileInfoExif) => {
        _state.fileInfoExifByFileID.set(fileID, exifData);
        _state.exifObserverByFileID.get(fileID)?.(exifData);
        return exifData;
    };

    // For videos, insert a placeholder.
    if (fileType === FileType.video) {
        return updateNotifyAndReturn(createPlaceholderFileInfoExif());
    }

    // This is not a video, but the original image is not available yet.
    if (!originalImageBlob) return;

    try {
        const file = new File([originalImageBlob], "");
        const tags = await extractRawExif(file);
        const parsed = parseExif(tags);
        return updateNotifyAndReturn({ tags, parsed });
    } catch (e) {
        log.error("Failed to extract exif", e);
        // Save the empty placeholder exif corresponding to the file, no point
        // in unnecessarily retrying this, it will deterministically fail again.
        return updateNotifyAndReturn(createPlaceholderFileInfoExif());
    }
};

const createPlaceholderFileInfoExif = (): FileInfoExif => ({
    tags: undefined,
    parsed: undefined,
});

/**
 * Clear any cached {@link FileInfoExif} for the given {@link ItemData}.
 */
export const forgetExifForItemData = ({ fileID }: ItemData) => {
    _state.fileInfoExifByFileID.delete(fileID);
    _state.exifObserverByFileID.delete(fileID);
};

/**
 * Clear all cached {@link FileInfoExif}.
 */
export const forgetExif = () => {
    _state.fileInfoExifByFileID.clear();
    _state.exifObserverByFileID.clear();
};
