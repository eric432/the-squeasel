//! Output size for one image. No pixels are touched here.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FitMode {
    Fill,
    Fit,
    Pad,
    Scale,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OutputFormat {
    Jpeg,
    Png,
    Webp,
    /// JPEG and WebP, or PNG and WebP when any pixel is transparent. The export uses the winner.
    Smallest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Anchor {
    TopLeft,
    Top,
    TopRight,
    Left,
    #[default]
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

/// What the resampler should produce. Dimensions are after EXIF orientation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ResizePlan {
    pub content_width: u32,
    pub content_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    /// Centered source crop. The full frame unless Fill trims overflow.
    pub crop_x: u32,
    pub crop_y: u32,
    pub crop_width: u32,
    pub crop_height: u32,
    /// Where the resized photo sits on the output canvas. Non-zero only for Pad.
    pub offset_x: u32,
    pub offset_y: u32,
    /// Never-upscale refused to enlarge the photo, so the content is the original.
    pub kept_native: bool,
    /// Fill was changed to Fit because covering the frame would have enlarged the photo.
    pub fell_back_to_fit: bool,
    /// The frame Fill, Fit, or Pad was aiming at, before never-upscale changed the output.
    pub frame_width: u32,
    pub frame_height: u32,
}

pub(crate) fn plan_resize(
    src_width: u32,
    src_height: u32,
    width: Option<u32>,
    height: Option<u32>,
    mode: FitMode,
    never_upscale: bool,
    anchor: Anchor,
) -> Result<ResizePlan, ()> {
    if src_width == 0 || src_height == 0 {
        return Err(());
    }
    let width = positive(width);
    let height = positive(height);

    let (box_w, box_h, mode) = match mode {
        FitMode::Scale => match (width, height) {
            (None, None) => (src_width, src_height, FitMode::Scale),
            (Some(width), _) => (
                width,
                scale_side(src_height, width, src_width),
                FitMode::Scale,
            ),
            (None, Some(height)) => (
                scale_side(src_width, height, src_height),
                height,
                FitMode::Scale,
            ),
        },
        FitMode::Fill | FitMode::Fit | FitMode::Pad => {
            let (box_w, box_h) = match (width, height) {
                (None, None) => (src_width, src_height),
                (Some(width), None) => (width, scale_side(src_height, width, src_width)),
                (None, Some(height)) => (scale_side(src_width, height, src_height), height),
                (Some(width), Some(height)) => (width, height),
            };
            (box_w, box_h, mode)
        }
    };

    let fell_back_to_fit = mode == FitMode::Fill
        && never_upscale
        && would_cover_upscale(src_width, src_height, box_w, box_h);
    let mode = if fell_back_to_fit { FitMode::Fit } else { mode };

    match mode {
        FitMode::Fill => {
            let (crop_x, crop_y, crop_width, crop_height) =
                cover_crop(src_width, src_height, box_w, box_h, anchor);
            Ok(ResizePlan {
                content_width: box_w,
                content_height: box_h,
                output_width: box_w,
                output_height: box_h,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
                offset_x: 0,
                offset_y: 0,
                kept_native: false,
                fell_back_to_fit: false,
                frame_width: box_w,
                frame_height: box_h,
            })
        }
        FitMode::Fit | FitMode::Scale => {
            let (fitted_w, fitted_h) = if mode == FitMode::Scale {
                (box_w, box_h)
            } else {
                fit_inside(src_width, src_height, box_w, box_h)
            };
            let kept_native = never_upscale && (fitted_w > src_width || fitted_h > src_height);
            let (content_w, content_h) = if kept_native {
                (src_width, src_height)
            } else {
                (fitted_w, fitted_h)
            };
            Ok(full_frame(
                src_width,
                src_height,
                content_w,
                content_h,
                kept_native,
                fell_back_to_fit,
                box_w,
                box_h,
            ))
        }
        FitMode::Pad => {
            let (fitted_w, fitted_h) = fit_inside(src_width, src_height, box_w, box_h);
            let kept_native = never_upscale && (fitted_w > src_width || fitted_h > src_height);
            let (content_w, content_h) = if kept_native {
                (src_width, src_height)
            } else {
                (fitted_w, fitted_h)
            };
            let output_w = box_w.max(content_w);
            let output_h = box_h.max(content_h);
            Ok(ResizePlan {
                content_width: content_w,
                content_height: content_h,
                output_width: output_w,
                output_height: output_h,
                crop_x: 0,
                crop_y: 0,
                crop_width: src_width,
                crop_height: src_height,
                offset_x: output_w.saturating_sub(content_w) / 2,
                offset_y: output_h.saturating_sub(content_h) / 2,
                kept_native,
                fell_back_to_fit: false,
                frame_width: box_w,
                frame_height: box_h,
            })
        }
    }
}

/// Fill kept less than half of the working image. A manual crop is not counted here.
pub(crate) fn discards_more_than_half(src_width: u32, src_height: u32, plan: &ResizePlan, mode: FitMode) -> bool {
    if mode != FitMode::Fill || plan.fell_back_to_fit {
        return false;
    }
    let source = u64::from(src_width).saturating_mul(u64::from(src_height));
    let kept = u64::from(plan.crop_width).saturating_mul(u64::from(plan.crop_height));
    source > 0 && kept.saturating_mul(2) < source
}

fn positive(value: Option<u32>) -> Option<u32> {
    value.filter(|value| *value > 0)
}

fn scale_side(src_side: u32, numer: u32, denom: u32) -> u32 {
    ((u64::from(src_side) * u64::from(numer) + u64::from(denom) / 2) / u64::from(denom)).max(1)
        as u32
}

pub(crate) fn scale_to(src_side: u32, numer: u32, denom: u32) -> u32 {
    scale_side(src_side, numer, denom)
}

/// True when a cover resize would enlarge the photo.
fn would_cover_upscale(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> bool {
    dst_w > src_w || dst_h > src_h
}

fn fit_inside(src_w: u32, src_h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let src_w = u64::from(src_w);
    let src_h = u64::from(src_h);
    let max_w = u64::from(max_w.max(1));
    let max_h = u64::from(max_h.max(1));
    if src_w * max_h >= src_h * max_w {
        let height = (src_h * max_w + src_w / 2) / src_w;
        (max_w as u32, clamp_side(height, max_h))
    } else {
        let width = (src_w * max_h + src_h / 2) / src_h;
        (clamp_side(width, max_w), max_h as u32)
    }
}

fn clamp_side(value: u64, max: u64) -> u32 {
    value.clamp(1, max) as u32
}

/// Crop of the source that matches the destination aspect, placed by the anchor.
fn cover_crop(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32, anchor: Anchor) -> (u32, u32, u32, u32) {
    let src_w64 = u64::from(src_w);
    let src_h64 = u64::from(src_h);
    let dst_w64 = u64::from(dst_w.max(1));
    let dst_h64 = u64::from(dst_h.max(1));
    let (crop_w, crop_h) = if src_w64 * dst_h64 > src_h64 * dst_w64 {
        let crop_w = ((src_h64 * dst_w64 + dst_h64 / 2) / dst_h64).clamp(1, src_w64) as u32;
        (crop_w, src_h)
    } else {
        let crop_h = ((src_w64 * dst_h64 + dst_w64 / 2) / dst_w64).clamp(1, src_h64) as u32;
        (src_w, crop_h)
    };
    let x = place_offset(src_w.saturating_sub(crop_w), anchor_x(anchor));
    let y = place_offset(src_h.saturating_sub(crop_h), anchor_y(anchor));
    (x, y, crop_w, crop_h)
}

fn place_offset(slack: u32, align: i8) -> u32 {
    match align {
        -1 => 0,
        1 => slack,
        _ => slack / 2,
    }
}

fn anchor_x(anchor: Anchor) -> i8 {
    match anchor {
        Anchor::TopLeft | Anchor::Left | Anchor::BottomLeft => -1,
        Anchor::TopRight | Anchor::Right | Anchor::BottomRight => 1,
        _ => 0,
    }
}

fn anchor_y(anchor: Anchor) -> i8 {
    match anchor {
        Anchor::TopLeft | Anchor::Top | Anchor::TopRight => -1,
        Anchor::BottomLeft | Anchor::Bottom | Anchor::BottomRight => 1,
        _ => 0,
    }
}

fn full_frame(
    src_w: u32,
    src_h: u32,
    content_w: u32,
    content_h: u32,
    kept_native: bool,
    fell_back_to_fit: bool,
    frame_width: u32,
    frame_height: u32,
) -> ResizePlan {
    ResizePlan {
        content_width: content_w,
        content_height: content_h,
        output_width: content_w,
        output_height: content_h,
        crop_x: 0,
        crop_y: 0,
        crop_width: src_w,
        crop_height: src_h,
        offset_x: 0,
        offset_y: 0,
        kept_native,
        fell_back_to_fit,
        frame_width,
        frame_height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHOTO_W: u32 = 4032;
    const PHOTO_H: u32 = 3024;

    fn file_suffix(
        mode: FitMode,
        width: Option<u32>,
        height: Option<u32>,
        plan: &ResizePlan,
    ) -> String {
        match mode {
            FitMode::Scale => match (positive(width), positive(height)) {
                (Some(_), _) => format!("-{}w", plan.output_width),
                (None, Some(_)) => format!("-{}h", plan.output_height),
                (None, None) => format!("-{}x{}", plan.output_width, plan.output_height),
            },
            _ => format!("-{}x{}", plan.output_width, plan.output_height),
        }
    }

    #[test]
    fn fill_is_exact_and_crops_the_tall_sides() {
        let plan = plan_resize(
            PHOTO_W,
            PHOTO_H,
            Some(1920),
            Some(800),
            FitMode::Fill,
            true,
            Anchor::Center,
        )
        .unwrap();
        assert_eq!((plan.output_width, plan.output_height), (1920, 800));
        assert_eq!(plan.crop_x, 0);
        assert_eq!(plan.crop_width, PHOTO_W);
        assert!(plan.crop_height < PHOTO_H);
        assert_eq!(plan.crop_y, (PHOTO_H - plan.crop_height) / 2);
        assert!(!plan.kept_native);
        assert!(discards_more_than_half(PHOTO_W, PHOTO_H, &plan, FitMode::Fill) == (plan.crop_height * 2 < PHOTO_H));
    }

    #[test]
    fn a_wide_fill_that_keeps_less_than_half_is_heavy() {
        let plan = plan_resize(8, 4, Some(8), Some(1), FitMode::Fill, true, Anchor::Center).unwrap();
        assert!(discards_more_than_half(8, 4, &plan, FitMode::Fill));
        let fit = plan_resize(8, 4, Some(8), Some(1), FitMode::Fit, true, Anchor::Center).unwrap();
        assert!(!discards_more_than_half(8, 4, &fit, FitMode::Fit));
    }

    #[test]
    fn fit_stays_inside_the_frame() {
        let plan = plan_resize(
            PHOTO_W,
            PHOTO_H,
            Some(1920),
            Some(800),
            FitMode::Fit,
            true,
            Anchor::Center,
        )
        .unwrap();
        assert!(plan.output_width <= 1920);
        assert_eq!(plan.output_height, 800);
        assert!(plan.output_width < 1920);
        assert_eq!(plan.crop_width, PHOTO_W);
    }

    #[test]
    fn pad_canvas_is_exact_and_content_is_centered() {
        let plan = plan_resize(
            PHOTO_W,
            PHOTO_H,
            Some(1920),
            Some(800),
            FitMode::Pad,
            true,
            Anchor::Center,
        )
        .unwrap();
        assert_eq!((plan.output_width, plan.output_height), (1920, 800));
        assert!(plan.content_width < 1920);
        assert_eq!(plan.content_height, 800);
        assert_eq!(plan.offset_x, (1920 - plan.content_width) / 2);
        assert_eq!(plan.offset_y, 0);
    }

    #[test]
    fn scale_width_only_and_height_only_keep_proportions() {
        let by_width = plan_resize(PHOTO_W, PHOTO_H, Some(1920), None, FitMode::Scale, true, Anchor::Center).unwrap();
        assert_eq!((by_width.output_width, by_width.output_height), (1920, 1440));
        assert_eq!(file_suffix(FitMode::Scale, Some(1920), None, &by_width), "-1920w");

        let by_height =
            plan_resize(PHOTO_W, PHOTO_H, None, Some(800), FitMode::Scale, false, Anchor::Center).unwrap();
        assert_eq!(by_height.output_height, 800);
        assert_eq!(by_height.output_width, scale_side(PHOTO_W, 800, PHOTO_H));
        assert_eq!(
            file_suffix(FitMode::Scale, None, Some(800), &by_height),
            format!("-{}h", by_height.output_height)
        );
    }

    #[test]
    fn empty_height_on_fill_follows_the_aspect_ratio() {
        let plan = plan_resize(PHOTO_W, PHOTO_H, Some(1920), None, FitMode::Fill, true, Anchor::Center).unwrap();
        assert_eq!((plan.output_width, plan.output_height), (1920, 1440));
        assert_eq!(plan.crop_width, PHOTO_W);
        assert_eq!(plan.crop_height, PHOTO_H);
    }

    #[test]
    fn tiny_image_is_not_upscaled_and_fill_falls_back() {
        let plan = plan_resize(100, 80, Some(1920), Some(800), FitMode::Fill, true, Anchor::Center).unwrap();
        assert!(plan.kept_native);
        assert!(plan.fell_back_to_fit);
        assert_eq!((plan.frame_width, plan.frame_height), (1920, 800));
        assert_eq!((plan.output_width, plan.output_height), (100, 80));
        assert_eq!((plan.crop_width, plan.crop_height), (100, 80));
    }

    #[test]
    fn fill_falls_back_to_fit_without_staying_native() {
        let plan = plan_resize(107, 800, Some(1920), Some(800), FitMode::Fill, true, Anchor::Center).unwrap();
        assert!(plan.fell_back_to_fit);
        assert!(!plan.kept_native);
        assert_eq!((plan.frame_width, plan.frame_height), (1920, 800));
        assert_eq!((plan.output_width, plan.output_height), (107, 800));
    }

    #[test]
    fn portrait_frame_crops_the_sides() {
        // A 6×2 landscape turned on its side is measured as 2×6 before this runs.
        let plan = plan_resize(2, 6, Some(4), Some(4), FitMode::Fill, false, Anchor::Center).unwrap();
        assert_eq!((plan.output_width, plan.output_height), (4, 4));
        assert_eq!(plan.crop_width, 2);
        assert!(plan.crop_height < 6);
        assert_eq!(plan.crop_y, (6 - plan.crop_height) / 2);
    }

    #[test]
    fn fill_anchor_picks_the_kept_edge() {
        let left = plan_resize(400, 100, Some(100), Some(100), FitMode::Fill, false, Anchor::TopLeft).unwrap();
        let right = plan_resize(400, 100, Some(100), Some(100), FitMode::Fill, false, Anchor::BottomRight).unwrap();
        let center = plan_resize(400, 100, Some(100), Some(100), FitMode::Fill, false, Anchor::Center).unwrap();
        assert_eq!(left.crop_x, 0);
        assert_eq!(right.crop_x, 400 - right.crop_width);
        assert_eq!(center.crop_x, (400 - center.crop_width) / 2);
        assert!(right.crop_x > center.crop_x);

        let top = plan_resize(100, 400, Some(100), Some(100), FitMode::Fill, false, Anchor::Top).unwrap();
        let bottom = plan_resize(100, 400, Some(100), Some(100), FitMode::Fill, false, Anchor::Bottom).unwrap();
        assert_eq!(top.crop_y, 0);
        assert_eq!(bottom.crop_y, 400 - bottom.crop_height);
        assert!(bottom.crop_y > top.crop_y);
    }

    #[test]
    fn never_upscale_off_enlarges_a_tiny_image() {
        let plan = plan_resize(100, 80, Some(200), Some(160), FitMode::Fit, false, Anchor::Center).unwrap();
        assert!(!plan.kept_native);
        assert_eq!((plan.output_width, plan.output_height), (200, 160));
    }
}
