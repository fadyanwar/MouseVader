# Introduction
Many companies including Facebook and Google do track their users behavior on their own websites or on the websites of other companies or people using their services. This simply works by tracking the user behavior as in interest in different website areas via tracking the user's mouse pointer when it hovers on elements of the rendered HTML page. This way, based on your behavior, you can be classified into cluster groups for easier targeting of ad campaigns. You can clearly see this ongoing tracking by simply observing the network tab on your browser when you merely hover on any element of the page.

The purpose of this extension is to subvert and circumvent this tracking tactic by creating fake random mouse events while you are staying on any web page to simulate actual user behavior but in a totally random way. So your actual behavioral data would be diluted purposefully with random and irrelevant data which, with time, would make it pretty difficult for tracking services to build a profile of you.

To install this extension on Firefox visit https://addons.mozilla.org/en-US/firefox/addon/mousevader

# How to build
In order to build this extension you will need to install web-ext following the steps found here https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/

Then use the below command to build your extension package
```console
web-ext build -s MouseVader/Firefox -a artifacts/
```

where "artifacts" is the folder you wish to place the output package at
