const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

class Crawler {
  constructor(url) {
    this.startURL = url;
    // HTML as string
    this.startHTML = '';
    // {category name: category object}
    this.categories = {};
  }

  // args: url
  // out: returns html content
  async getHTMLwithURL(url) {
    if (!url) {
      throw new Error('No URL provided.');
    }
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url,{timeout:60000}).catch((err) => {
      browser.close();
      throw new Error(err);
    });
    let html = await page.content();
    browser.close();
    return html;
  }

  // args: url, iframe id
  // out: returns [html content, html content of iframe]
  async getHTMLandFrame(url, id) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url,{timeout:60000}).catch((err) => {
      browser.close();
      throw new Error(err);
    });
    let html = await page.content();
    const frame = await page.frames().find(frame => frame.name() === id);
    const frameHTML = await frame.content();
    browser.close();
    return [html,frameHTML];
  }

  // out: html content => crawler.startHTML
  async loadStartPage() {
    const html = await this.getHTMLwithURL(this.startURL).catch((err) => {
      console.log('Could not load start page.')
      console.error(err);
      return 0;
    });
    this.startHTML = html;
    console.log('Start page fetched successfully.');
  }

  // args: html string
  // out: populates crawler.categories with category objects
  async discoverCategories(html) {
    // default html = startHTML
    if(html === undefined) {
      html = this.startHTML;
    }
    const $ = await cheerio.load(html);
    // parse for form object containing drop down with all categories
    const form = await $('form[name="site-search"]');
    // initialize variables needed to generate URI string
    const baseURL = this.startURL;
    const action = await form.attr('action');
    const category_fieldname = await encodeURIComponent(form.find('select').attr('name'));
    const searchname = await encodeURIComponent(form.find('input[type=text]').attr('name'));
    // temperary reference to crawler for access within .each loop
    const tempThis = this;
    // for each option/category in drop down create category object
    await form.find('select').find('option').each(function(i, element) {
      element = $(element);
      const category_field_val = encodeURIComponent(element.attr('value'));
      const name = element.text();
      const url = baseURL + action + '?' + category_fieldname + '=' + category_field_val + '&' + searchname + '=';
      // create Category object and push to crawler.categories
      const cat = new Category(name, url);
      tempThis.categories[name] = cat;
    });
    console.log('Categories populated successfully.');
  }

  // args: category name
  // out: populates category.listings with listings object
  async crawlCategory(catName) {
    const cat = await this.categories[catName];
    const baseURL = this.startURL;
    const catURL = await cat.getURL();
    const html = await this.getHTMLwithURL(catURL).catch((err) => {
      console.log('Could not fetch category page.');
      console.log(err);
      return 0;
    });
    const $ = await cheerio.load(html);
    // fetch every listing (link) in left nav bar
    const leftNav = await $('div[aria-label="Left Navigation"]');
    leftNav.find('a').each(function(i,element) {
      element = $(element);
      const name = element.text().trim();
      let url = element.attr('href').trim();
      // make sure url has base url
      if (!(url.startsWith('https://') || url.startsWith('http://') || url.startsWith('www.'))) {
        url = baseURL + url;
      }
      const listing = new Listing(name, catName, url);
      cat.listings[name] = listing;
    });
    console.log('Category crawled successfully.');
  }

  // args: category name, listings name, number of products to crawl
  // out: populates listing.products with product objects
  async crawlListing(catName, listName, numProds) {
    const baseURL = this.startURL;
    const category = await this.categories[catName];
    const listing = await category.getListings()[listName];
    const listingProducts = await listing.getProducts();
    const listingURL = await listing.getURL();
    var html = await this.getHTMLwithURL(listingURL).catch((err) => {
      console.log('Could not fetch listing page.');
      console.log(err);
      return 0;
    });
    var $ = await cheerio.load(html);
    var resultDiv = await $('div[class="s-result-list sg-row"]');
    // indexes
    var numCrawled = 0;
    var pageIndex = 0;
    // crawl results for products
    while (numCrawled < numProds) {
      console.log('Crawling product number '+(numCrawled+1)+'.');
      // get product url using data-index = pageIndex
      var prodURL = resultDiv.find('div[data-index='+pageIndex+']').find('span[data-component-type="s-product-image"]').find('a').attr('href');
      // validate url
      if (!(prodURL.startsWith('https://') || prodURL.startsWith('http://') || prodURL.startsWith('www.'))) {
        prodURL = baseURL + prodURL;
      }
      // crawl product
      const product = await this.crawlProduct(catName, listName, prodURL);
      // push product to listing.products
      listingProducts.push(product);
      numCrawled++;
      pageIndex++;
      // if next page
      // there are 16 products per page
      if (pageIndex == 16 && numCrawled < numProds) {
        console.log('Loading next page.');
        var nextPageURL = $('span[data-component-type="s-pagination"]').find('li[class="a-last"]').find('a').attr('href');
        // validate URL
        if (!(nextPageURL.startsWith('https://') || nextPageURL.startsWith('http://') || nextPageURL.startsWith('www.'))) {
          nextPageURL = baseURL + nextPageURL;
        }
        // set context to next page
        html = await this.getHTMLwithURL(nextPageURL).catch((err) => {
          console.log('Could not fetch listings next page.');
          console.log(err);
          return 0;
        });
        $ = await cheerio.load(html);
        resultDiv = await $('div[class="s-result-list sg-row"]');
        pageIndex = 0;
      }
    }
    console.log('Listing crawled successfully.');
  }

  // args = category name, listing name, produc source URL
  // out: returns product object
  async crawlProduct(catName, listName, url) {
    var invalidURL = false;
    const htmlTemp = await this.getHTMLandFrame(url,'bookDesc_iframe').catch((err) => {
      invalidURL = true;
      console.log('A product link failed.');
      console.log(err);
    });
    if (invalidURL) {
      return new Product(catName, listName, url);
    }
    const html = htmlTemp[0];
    const iFrameHTML = htmlTemp[1];
    const $ = await cheerio.load(html);
    const product = await new Product(catName, listName, url);

    const name = $('span[id="productTitle"]').text();
    product.setName(name);

    // id = ISBN13 number for book
    const id = $('div[id="detail-bullets"]').find('div[class="content"]').find('li:contains("ISBN-13")').text().split(':')[1].trim();
    product.setID(id);

    const listPrice = Number($('div[id="buyNewSection"]').find('span[class="a-size-medium a-color-price offer-price a-text-normal"]').text().replace('$',''));
    product.setListPrice(listPrice);

    // parse iFrame for description
    const iFrame$ = await cheerio.load(iFrameHTML);
    var description = '';
    // no coherent structure for text structure within content div so div.text() => best results I could obtain
    description = iFrame$('div[id="iframeContent"]').text();
    product.setDescription(description);

    const dimensions = $('div[id="detail-bullets"]').find('div[class="content"]').find('li:contains("Dimensions")').text().split(':')[1].trim();
    product.setProductDimensions(dimensions);

    $('div[id="imageBlockThumbs"]').find('img').each(function(i,element){
      element = $(element);
      const imageURL = element.attr('src');
      product.addImageURL(imageURL);
    });

    const weight = $('div[id="detail-bullets"]').find('div[class="content"]').find('li:contains("Weight")').text().split(':')[1].split('(')[0].trim();
    product.setWeight(weight);

    return product;
  }

  // args: category name, relative path to outputfile + outputfile name
  async toJSONfile(category, path) {
    try {
      // add date to output file
      var d = new Date();
      const date = d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate();
      // for each listings in category, if contains book products, add products to [data] for outputfile
      const data = [];
      Object.values(this.categories[category].getListings()).forEach(function (element) {
        if (element.getProducts().length > 0) {
          element.getProducts().forEach(function (element) {
            data.push(element);
          });
        }
      });
      var obj = {
        category: category,
        date: date,
        products: data
      };
      fs.writeFileSync(path, JSON.stringify(obj, null, 2));
      console.log('JSON file created!');
    } catch (err) {
      console.log('Failed to create JSON file.');
      console.error(err);
    }
  }

  // get methods
  getCategories() {
    return this.categories;
  }
  getStartURL() {
    return this.startURL;
  }
  getStartHTML() {
    return this.startHTML;
  }
}

// represents a category page pointing to listings
class Category {
  constructor(name, url) {
    this.name = name;
    this.url = url;
    // {'name of listing page': listing object}
    this.listings = {};
  }

  // get methods
  getName() {
    return this.name;
  }
  getURL() {
    return this.url;
  }
  getListings() {
    return this.listings;
  }
}

// represents a listing page containing products
class Listing {
  constructor(name, category, url) {
    this.name = name;
    this.category = category;
    this.url = url;
    this.products = [];
  }

  // get methods
  getName() {
    return this.name;
  }
  getURL() {
    return this.url;
  }
  getProducts() {
    return this.products;
  }
}

// represents a product
class Product{
  constructor(catName, listName, url) {
    this.category = catName;
    this.listing = listName
    this.sourceURL = url;
    this.name = '';
    this.id = '';
    this.listPrice = 0;
    this.description = '';
    this.productDimensions = '';
    this.imageURLs = [];
    this.weight = '';
  }

  // set methods
  setName(name) {
    this.name = name;
  }
  setID(id) {
    this.id = id;
  }
  setListPrice(price) {
    this.listPrice = price;
  }
  setDescription(desc) {
    this.description = desc;
  }
  setProductDimensions(dims) {
    this.productDimensions = dims;
  }
  addImageURL(url) {
    this.imageURLs.push(url);
  }
  setWeight(w) {
    this.weight = w;
  }

  // get methods
  getName() {
    return this.name;
  }
  getListing() {
    return this.listing;
  }
  getCategory() {
    return this.category;
  }
  getID() {
    return this.id;
  }
  getURL() {
    return this.sourceURL;
  }
  getListPrice() {
    return this.listPrice;
  }
  getDescription() {
    return this.description;
  }
  getProductDimensions() {
    return this.productDimensions;
  }
  getImageURLs() {
    return this.imageURLs;
  }
  getWeight() {
    return this.weight;
  }
}

async function main() {
  // create crawler object
  const amazon = await new Crawler('https://www.amazon.com');
  // fetch start page html into crawler.html
  await amazon.loadStartPage();
  // fetch all category links into crawler.categories
  await amazon.discoverCategories();
  // fetch all listings in 'Books' category into category.listings
  await amazon.crawlCategory('Books');
  // fetch all products in 'Last 30 days' listing into listing.products
  await amazon.crawlListing('Books','Last 30 days',20);
  // output all products in Books category to JSON file
  await amazon.toJSONfile('Books', './data/data.json');
}

main();
