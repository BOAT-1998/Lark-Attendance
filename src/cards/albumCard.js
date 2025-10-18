// Helper function to format dates into DD/MM/YY using the Thai locale.
const formatDate = (date) => {
  // Create a date formatter for the Thai locale with two-digit components.
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
};

// Build a Lark interactive card for the album summary.
const buildAlbumCard = (album) => {
  // Format the descriptive subtitle showing image count and creation date.
  const subtitle = `\ud83d\udcf8 ${album.imageCount} รูป | ${formatDate(album.createdAt)}`;

  // Return the card JSON structure following Lark card schema.
  return {
    config: {
      update_multi: true,
    },
    elements: [
      {
        tag: 'img',
        img_key: album.gridImageToken,
        mode: 'fit_horizontal',
        alt: {
          tag: 'plain_text',
          content: 'Album preview',
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'plain_text',
          content: subtitle,
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'ดูทั้งหมด',
            },
            type: 'primary',
            multi_url: {
              url: album.docShareLink,
              android_url: album.docShareLink,
              ios_url: album.docShareLink,
              pc_url: album.docShareLink,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'ดาวน์โหลดอัลบั้ม',
            },
            type: 'default',
            multi_url: {
              url: album.zipShareLink,
              android_url: album.zipShareLink,
              ios_url: album.zipShareLink,
              pc_url: album.zipShareLink,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'แชร์อัลบั้ม',
            },
            type: 'default',
            multi_url: {
              url: album.docShareLink,
              android_url: album.docShareLink,
              ios_url: album.docShareLink,
              pc_url: album.docShareLink,
            },
          },
        ],
      },
    ],
    header: {
      title: {
        tag: 'plain_text',
        content: 'อัลบั้มภาพใหม่พร้อมดู!',
      },
    },
  };
};

// Export the builder function for use by the webhook handler.
module.exports = buildAlbumCard;
