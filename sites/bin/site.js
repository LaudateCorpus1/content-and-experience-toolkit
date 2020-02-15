/**
 * Copyright (c) 2019 Oracle and/or its affiliates. All rights reserved.
 * Licensed under the Universal Permissive License v 1.0 as shown at http://oss.oracle.com/licenses/upl.
 */
/* global console, __dirname, process, module, Buffer, console */
/* jshint esversion: 6 */

var fs = require('fs'),
	fse = require('fs-extra'),
	path = require('path'),
	semver = require('semver'),
	sprintf = require('sprintf-js').sprintf,
	documentUtils = require('./document.js').utils,
	templateUtils = require('./template.js').utils,
	siteUpdateLib = require('./siteUpdate.js'),
	serverRest = require('../test/server/serverRest.js'),
	sitesRest = require('../test/server/sitesRest.js'),
	serverUtils = require('../test/server/serverUtils.js');

var projectDir,
	documentsSrcDir,
	serversSrcDir;

//
// Private functions
//

var verifyRun = function (argv) {
	projectDir = argv.projectDir;

	var srcfolder = serverUtils.getSourceFolder(projectDir);

	// reset source folders
	documentsSrcDir = path.join(srcfolder, 'documents');
	serversSrcDir = path.join(srcfolder, 'servers');

	return true;
};

var localServer;
var _cmdEnd = function (done, success) {
	done(success);
	if (localServer) {
		localServer.close();
	}
};


/**
 * create site
 */
module.exports.createSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		_cmdEnd(done);
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		_cmdEnd(done);
		return;
	}

	var request = serverUtils.getRequest();

	var name = argv.name;
	var templateName = argv.template;
	var repositoryName = argv.repository;
	var localizationPolicyName = argv.localizationPolicy;
	var defaultLanguage = argv.defaultLanguage;
	var description = argv.description;
	var sitePrefix = argv.sitePrefix || name.toLowerCase();
	sitePrefix = sitePrefix.substring(0, 15);
	var updateContent = typeof argv.update === 'string' && argv.update.toLowerCase() === 'true';

	if (server.useRest) {
		_createSiteREST(request, server, name, templateName, repositoryName, localizationPolicyName, defaultLanguage, description, sitePrefix, done);
	} else {
		_createSiteSCS(request, server, name, templateName, repositoryName, localizationPolicyName, defaultLanguage, description, sitePrefix, updateContent, done);
	}
};


/**
 * Use Idc Service APIs to create a site
 * @param {*} request 
 * @param {*} server 
 * @param {*} name 
 * @param {*} templateName 
 * @param {*} repositoryName 
 * @param {*} localizationPolicyName 
 * @param {*} defaultLanguage 
 * @param {*} description 
 * @param {*} sitePrefix 
 */
var _createSiteSCS = function (request, server, siteName, templateName, repositoryName, localizationPolicyName, defaultLanguage, description, sitePrefix, updateContent, done) {

	try {
		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			var express = require('express');
			var app = express();

			var port = '9191';
			var localhost = 'http://localhost:' + port;

			var dUser = '';
			var idcToken;

			var auth = serverUtils.getRequestAuth(server);

			var template, templateGUID;
			var repositoryId, localizationPolicyId;
			var createEnterprise;

			var cecVersion;

			var format = '   %-20s %-s';

			app.get('/*', function (req, res) {
				// console.log('GET: ' + req.url);
				if (req.url.indexOf('/documents/') >= 0 || req.url.indexOf('/content/') >= 0) {
					var url = server.url + req.url;

					var options = {
						url: url,
					};

					options['auth'] = auth;

					request(options).on('response', function (response) {
							// fix headers for cross-domain and capitalization issues
							serverUtils.fixHeaders(response, res);
						})
						.on('error', function (err) {
							console.log('ERROR: GET request failed: ' + req.url);
							console.log(error);
							return resolve({
								err: 'err'
							});
						})
						.pipe(res);

				} else {
					console.log('ERROR: GET request not supported: ' + req.url);
					res.write({});
					res.end();
				}
			});
			app.post('/documents/web', function (req, res) {
				// console.log('POST: ' + req.url);
				var url = server.url + req.url;

				var repositoryPrefix = cecVersion && semver.gte(semver.coerce(cecVersion), '19.4.3') ? 'arCaaSGUID' : 'fFolderGUID';
				// console.log(' - CEC version: ' + cecVersion + ' repositoryPrefix: ' + repositoryPrefix);
				var formData = createEnterprise ? {
					'idcToken': idcToken,
					'names': siteName,
					'descriptions': description,
					'items': 'fFolderGUID:' + templateGUID,
					'isEnterprise': '1',
					'repository': repositoryPrefix + ':' + repositoryId,
					'slugPrefix': sitePrefix,
					'defaultLanguage': defaultLanguage,
					'localizationPolicy': localizationPolicyId,
					'useBackgroundThread': 1
				} : {
					'idcToken': idcToken,
					'names': siteName,
					'descriptions': description,
					'items': 'fFolderGUID:' + templateGUID,
					'useBackgroundThread': 1
				};

				// keep the existing ids
				if (updateContent) {
					formData['doPreserveCaaSGUID'] = 1;
				}

				var postData = {
					method: 'POST',
					url: url,
					auth: auth,
					formData: formData
				};

				request(postData).on('response', function (response) {
						// fix headers for cross-domain and capitalization issues
						serverUtils.fixHeaders(response, res);
					})
					.on('error', function (err) {
						console.log('ERROR: Failed to ' + action + ' site');
						console.log(error);
						return resolve({
							err: 'err'
						});
					})
					.pipe(res)
					.on('finish', function (err) {
						res.end();
					});

			});

			localServer = app.listen(0, function () {
				port = localServer.address().port;
				localhost = 'http://localhost:' + port;
				localServer.setTimeout(0);

				var inter = setInterval(function () {
					// console.log(' - getting login user: ' + total);
					var url = localhost + '/documents/web?IdcService=SCS_GET_TENANT_CONFIG';

					request.get(url, function (err, response, body) {
						var data = JSON.parse(body);
						dUser = data && data.LocalData && data.LocalData.dUser;
						idcToken = data && data.LocalData && data.LocalData.idcToken;
						if (dUser && dUser !== 'anonymous' && idcToken) {
							// console.log(' - dUser: ' + dUser + ' idcToken: ' + idcToken);
							clearInterval(inter);
							console.log(' - establish user session');

							// verify site 
							var sitePromise = serverUtils.browseSitesOnServer(request, server);
							sitePromise.then(function (result) {
									if (result.err) {
										return Promise.reject();
									}

									var sites = result.data || [];
									var site;
									for (var i = 0; i < sites.length; i++) {
										if (siteName.toLowerCase() === sites[i].fFolderName.toLowerCase()) {
											site = sites[i];
											break;
										}
									}
									if (site && site.fFolderGUID) {
										console.log('ERROR: site ' + siteName + ' already exists');
										return Promise.reject();
									}

									return serverUtils.getServerVersion(request, server);
								})
								.then(function (result) {
									cecVersion = result && result.version;

									// Verify template
									return serverUtils.browseSitesOnServer(request, server, 'framework.site.template');

								})
								.then(function (result) {
									if (!result || result.err) {
										return Promise.reject();
									}

									var templates = result.data;
									for (var i = 0; i < templates.length; i++) {
										if (templateName.toLowerCase() === templates[i].fFolderName.toLowerCase()) {
											templateGUID = templates[i].fFolderGUID;
											break;
										}
									}
									if (!templateGUID) {
										console.log('ERROR: template ' + templateName + ' does not exist');
										return Promise.reject();
									}

									// get other template info
									return _getOneIdcService(request, localhost, server, 'SCS_GET_SITE_INFO_FILE', 'siteId=SCSTEMPLATE_' + templateName + '&IsJson=1');
								})
								.then(function (result) {
									if (!result || result.err) {
										return Promise.reject();
									}

									template = result.base ? result.base.properties : undefined;
									if (!template || !template.siteName) {
										console.log('ERROR: failed to get template info');
										return Promise.reject();
									}

									console.log(' - get template ');
									// console.log(template);

									if (template.isEnterprise && !repositoryName) {
										console.log('ERROR: repository is required to create enterprise site');
										return Promise.reject();
									}

									createEnterprise = repositoryName ? true : false;

									if (createEnterprise && !template.localizationPolicy && !localizationPolicyName) {
										console.log('ERROR: localization policy is required to create enterprise site');
										return Promise.reject();
									}
									// Remove this condition when defaultLanguage returned from API /templates 
									if (createEnterprise && !defaultLanguage) {
										console.log('ERROR: default language is required to create enterprise site');
										return Promise.reject();
									}

									if (!createEnterprise) {
										console.log(' - creating standard site ...');
										console.log(sprintf(format, 'name', siteName));
										console.log(sprintf(format, 'template', templateName));

										var actionPromise = _postOneIdcService(request, localhost, server, 'SCS_COPY_SITES', 'create site', idcToken);
										actionPromise.then(function (result) {
											if (result.err) {
												_cmdEnd(done);
											} else {
												console.log(' - site created');
												_cmdEnd(done, true);
											}
										});

									} else {
										var repositoryPromise = serverUtils.getRepositoryFromServer(request, server, repositoryName);
										repositoryPromise.then(function (result) {
												//
												// validate repository
												//
												if (!result || result.err) {
													return Promise.reject();
												}

												var repository = result.data;
												if (!repository || !repository.id) {
													console.log('ERROR: repository ' + repositoryName + ' does not exist');
													return Promise.reject();
												}
												repositoryId = repository.id;
												console.log(' - get repository');

												var policyPromises = [];
												if (localizationPolicyName) {
													policyPromises.push(serverUtils.getLocalizationPolicyFromServer(request, server, localizationPolicyName));
												} else {
													policyPromises.push(serverUtils.getLocalizationPolicyFromServer(request, server, template.localizationPolicy, 'id'));
												}
												return Promise.all(policyPromises);
											})
											.then(function (results) {
												//
												// validate localization policy
												//
												var result = results.length > 0 ? results[0] : undefined;
												if (!result || result.err) {
													return Promise.reject();
												}

												var policy = result.data;
												if (!policy || !policy.id) {
													if (localizationPolicyName) {
														console.log('ERROR: localization policy ' + localizationPolicyName + ' does not exist');
													} else {
														console.log('ERROR: localization policy in template does not exist');
													}
													return Promise.reject();
												}

												if (localizationPolicyName) {
													console.log(' - get localization policy');
												} else {
													console.log(' - use localization policy from template: ' + policy.name);
												}
												localizationPolicyId = policy.id;

												//
												// validate default language
												//

												var requiredLanguages = policy.requiredValues;
												if (!requiredLanguages.includes(defaultLanguage)) {
													console.log('ERROR: language ' + defaultLanguage + ' is not in localization policy ' + policy.name);
													return Promise.reject();
												}

												//
												// create enterprise site
												//
												console.log(' - creating enterprise site ...');
												console.log(sprintf(format, 'name', siteName));
												console.log(sprintf(format, 'template', templateName));
												console.log(sprintf(format, 'site prefix', sitePrefix));
												console.log(sprintf(format, 'repository', repositoryName));
												console.log(sprintf(format, 'localization policy', policy.name));
												console.log(sprintf(format, 'default language', defaultLanguage));

												var actionPromise = _postOneIdcService(request, localhost, server, 'SCS_COPY_SITES', 'create site', idcToken);
												actionPromise.then(function (result) {
													if (result.err) {
														_cmdEnd(done);
													} else {
														console.log(' - site created');
														_cmdEnd(done, true);
													}
												});

											})
											.catch((error) => {
												_cmdEnd(done);
											});

									} // enterprise site
								})
								.catch((error) => {
									_cmdEnd(done);
								});
						}
					}); // idc token
				}, 5000);
			}); // local
		});
	} catch (e) {
		console.log(e);
		_cmdEnd(done);
	}
};

/**
 * Create a site using REST APIs
 * @param {*} request 
 * @param {*} server 
 * @param {*} name 
 * @param {*} templateName 
 * @param {*} repositoryName 
 * @param {*} localizationPolicyName 
 * @param {*} defaultLanguage 
 * @param {*} description 
 * @param {*} sitePrefix 
 * @param {*} done 
 */
var _createSiteREST = function (request, server, name, templateName, repositoryName, localizationPolicyName,
	defaultLanguage, description, sitePrefix, done) {
	var template, templateGUID;
	var repositoryId, localizationPolicyId;
	var createEnterprise;

	var format = '   %-20s %-s';
	var loginPromise = serverUtils.loginToServer(server, request);
	loginPromise.then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		sitesRest.resourceExist({
				server: server,
				type: 'sites',
				name: name
			}).then(function (result) {
				if (!result.err) {
					console.log('ERROR: site ' + name + ' already exists');
					return Promise.reject();
				}

				return sitesRest.getTemplate({
					server: server,
					name: templateName,
					expand: 'localizationPolicy'
				});
			})
			.then(function (result) {
				if (result.err) {
					return Promise.reject();
				}

				template = result;

				if (template.isEnterprise && !repositoryName) {
					console.log('ERROR: repository is required to create enterprise site');
					return Promise.reject();
				}

				createEnterprise = repositoryName ? true : false;

				if (createEnterprise && !template.localizationPolicy && !localizationPolicyName) {
					console.log('ERROR: localization policy is required to create enterprise site');
					return Promise.reject();
				}
				// Remove this condition when defaultLanguage returned from API /templates 
				if (createEnterprise && !defaultLanguage) {
					console.log('ERROR: default language is required to create enterprise site');
					return Promise.reject();
				}

				if (!createEnterprise) {
					console.log(' - creating standard site ...');
					console.log(sprintf(format, 'name', name));
					console.log(sprintf(format, 'template', templateName));

					sitesRest.createSite({
							server: server,
							name: name,
							templateId: template.id,
							templateName: templateName
						})
						.then(function (result) {
							if (result.err) {
								done();
							} else {
								console.log(' - site created');
								done(true);
							}
						});

				} else {

					serverRest.getRepositories({
							server: server
						})
						.then(function (result) {
							var repositories = result || [];
							for (var i = 0; i < repositories.length; i++) {
								if (repositories[i].name.toLowerCase() === repositoryName.toLowerCase()) {
									repositoryId = repositories[i].id;
									break;
								}
							}

							if (!repositoryId) {
								console.log('ERROR: repository ' + repositoryName + ' does not exist');
								return Promise.reject();
							}
							console.log(' - get repository');

							return serverRest.getLocalizationPolicies({
								server: server
							});
						})
						.then(function (result) {
							var policies = result || [];
							var policy;
							if (localizationPolicyName) {
								for (var i = 0; i < policies.length; i++) {
									if (policies[i].name === localizationPolicyName) {
										policy = policies[i];
										localizationPolicyId = policies[i].id;
										break;
									}
								}
								if (!localizationPolicyId) {
									console.log('ERROR: localization policy ' + localizationPolicyName + ' does not exist');
									return Promise.reject();
								}
								console.log(' - get localization policy');
							} else {
								for (var i = 0; i < policies.length; i++) {
									if (policies[i].id === template.localizationPolicy.id) {
										policy = policies[i];
										localizationPolicyId = policies[i].id;
										break;
									}
								}
								if (!localizationPolicyId) {
									console.log('ERROR: localization policy in template does not exist');
									return Promise.reject();
								}
								console.log(' - use localization policy from template: ' + policy.name);
							}

							var requiredLanguages = policy.requiredValues;
							if (!requiredLanguages.includes(defaultLanguage)) {
								console.log('ERROR: language ' + defaultLanguage + ' is not in localization policy ' + policy.name);
								return Promise.reject();
							}

							//
							// create enterprise site
							//
							console.log(' - creating enterprise site ...');
							console.log(sprintf(format, 'name', name));
							console.log(sprintf(format, 'template', templateName));
							console.log(sprintf(format, 'site prefix', sitePrefix));
							console.log(sprintf(format, 'repository', repositoryName));
							console.log(sprintf(format, 'localization policy', policy.name));
							console.log(sprintf(format, 'default language', defaultLanguage));

							return sitesRest.createSite({
								server: server,
								name: name,
								description: description,
								sitePrefix: sitePrefix,
								templateName: templateName,
								templateId: template.id,
								repositoryId: repositoryId,
								localizationPolicyId: localizationPolicyId,
								defaultLanguage: defaultLanguage
							});
						})
						.then(function (result) {
							if (result.err) {
								return Promise.reject();
							}

							console.log(' - site created');
							done(true);
						})
						.catch((error) => {
							done();
						});
				}
			})
			.catch((error) => {
				done();
			});
	});
};

/**
 * Transfer enterprise site
 */
module.exports.transferSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server;
	server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}

	var destServerName = argv.destination;
	var destServer = serverUtils.verifyServer(destServerName, projectDir);
	if (!destServer || !destServer.valid) {
		done();
		return;
	}

	if (server.url === destServer.url) {
		console.log('ERROR: source and destination server are the same');
		done();
		return;
	}

	var siteName = argv.name;
	var repositoryName = argv.repository;
	var localizationPolicyName = argv.localizationPolicy;

	var templateName = siteName + serverUtils.createGUID();
	templateName = templateName.substring(0, 40);
	var templatePath;
	var fileName, fileId;

	var creatNewSite = false;
	var repository;
	var policy;
	var site;
	var templateId;

	var cecVersion, idcToken;

	var actionSuccess = true;

	var request = serverUtils.getRequest();

	serverUtils.loginToServer(server, request)
		.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server ' + server.url);
				return Promise.reject();
			}

			return serverUtils.loginToServer(destServer, request);
		})
		.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server ' + destServer.url);
				return Promise.reject();
			}

			var express = require('express');
			var app = express();

			var port = '9191';
			var localhost = 'http://localhost:' + port;

			var auth = serverUtils.getRequestAuth(server);

			app.post('/documents/web', function (req, res) {
				// console.log('POST: ' + req.url);

				var url = destServer.url + req.url;
				var repositoryPrefix = cecVersion && semver.gte(semver.coerce(cecVersion), '19.4.3') ? 'arCaaSGUID' : 'fFolderGUID';
				var formData = {
					'idcToken': idcToken,
					'names': siteName,
					'descriptions': site.description,
					'items': 'fFolderGUID:' + templateId,
					'isEnterprise': '1',
					'repository': repositoryPrefix + ':' + repository.id,
					'slugPrefix': site.sitePrefix,
					'defaultLanguage': site.defaultLanguage,
					'localizationPolicy': policy.id,
					'useBackgroundThread': 1,
					'doPreserveCaaSGUID': 1
				};
				
				var postData = {
					method: 'POST',
					url: url,
					auth: serverUtils.getRequestAuth(destServer),
					formData: formData
				};
				if (destServer.cookies) {
					postData.headers = {
						Cookie: server.cookies
					};
				}
				request(postData).on('response', function (response) {
						// fix headers for cross-domain and capitalization issues
						serverUtils.fixHeaders(response, res);
					})
					.on('error', function (err) {
						console.log('ERROR: Failed to create site');
						console.log(error);
						return resolve({
							err: 'err'
						});
					})
					.pipe(res)
					.on('finish', function (err) {
						res.end();
					});

			});

			localServer = app.listen(0, function () {
				port = localServer.address().port;
				localhost = 'http://localhost:' + port;
				localServer.setTimeout(0);

				// verify site on source server
				sitesRest.getSite({
						server: server,
						name: siteName
					})
					.then(function (result) {
						if (!result || result.err) {
							return Promise.reject();
						}
						site = result;
						console.log(' - verify site (defaultLanguage: ' + site.defaultLanguage + ')');

						// check site on destination server
						return sitesRest.resourceExist({
							server: destServer,
							type: 'sites',
							name: siteName
						});
					})
					.then(function (result) {
						if (!result || result.err) {
							creatNewSite = true;
						}
						console.log(' - will ' + (creatNewSite ? 'create' : 'update') + ' site ' + siteName + ' on ' + destServer.url);

						if (creatNewSite) {
							if (!repositoryName) {
								console.log('ERROR: no repository is specified');
								return Promise.reject();
							}
							if (!localizationPolicyName) {
								console.log('ERROR: no localization policy is specified');
								return Promise.reject();
							}
						}

						var repositoryPromises = [];
						if (creatNewSite) {
							repositoryPromises.push(serverRest.getRepositoryWithName({
								server: destServer,
								name: repositoryName
							}));
						}

						return Promise.all(repositoryPromises);
					})
					.then(function (results) {
						if (creatNewSite) {
							if (!results || !results[0] || results[0].err || !results[0].data) {
								console.log('ERROR: repository ' + repositoryName + ' does not exist');
								return Promise.reject();
							}
							repository = results[0].data;
							console.log(' - verify repository');
						}

						var localizationPolicyPromises = [];
						if (creatNewSite) {
							localizationPolicyPromises.push(serverRest.getLocalizationPolicies({
								server: destServer
							}));
						}

						return Promise.all(localizationPolicyPromises);
					})
					.then(function (results) {
						if (creatNewSite) {
							if (!results || !results[0] || results[0].err) {
								console.log('ERROR: localization policy ' + localizationPolicyName + ' does not exist');
								return Promise.reject();
							}
							var policies = results[0] || [];
							for (var i = 0; i < policies.length; i++) {
								if (policies[i].name === localizationPolicyName) {
									policy = policies[i];
									break;
								}
							}
							if (!policy) {
								console.log('ERROR: localization policy ' + localizationPolicyName + ' does not exist');
								return Promise.reject();
							}

							var requiredLanguages = policy.requiredValues;
							if (!requiredLanguages.includes(site.defaultLanguage)) {
								console.log('ERROR: site default language ' + site.defaultLanguage + ' is not in localization policy ' + policy.name);
								return Promise.reject();
							}
							console.log(' - verify localization policy');
						}

						// create template based on the site on the source server
						var createTemplateArgv = {
							projectDir: projectDir,
							server: server,
							name: templateName,
							siteName: siteName,
							includeUnpublishedAssets: true
						};

						// create template on the source server and download
						return templateUtils.createTemplateFromSiteAndDownloadSCS(createTemplateArgv);

					})
					.then(function (result) {
						if (!result || result.err) {
							return Promise.reject();
						}

						fileName = templateName + '.zip';
						var destdir = path.join(projectDir, 'dist');
						if (!fs.existsSync(destdir)) {
							fs.mkdirSync(destdir);
						}
						templatePath = path.join(destdir, fileName);
						if (!fs.existsSync(templatePath)) {
							console.log('ERROR: failed to download template ' + templateName);
							return Promise.reject();
						}

						var uploadFilePromises = [];
						if (creatNewSite) {
							// upload template file to destination server
							uploadFilePromises.push(serverRest.createFile({
								server: destServer,
								parentID: 'self',
								filename: fileName,
								contents: fs.readFileSync(templatePath)
							}));
						}
						return Promise.all(uploadFilePromises);
					})
					.then(function (results) {
						if (creatNewSite) {
							if (!results || !results[0] || results[0].err || !results[0].id) {
								console.log('ERROR: failed to upload template file');
								return Promise.reject();
							}
							var uploadedFile = results[0];
							fileId = uploadedFile.id;
							console.log(' - file ' + fileName + ' uploaded to Home folder (Id: ' + fileId + ' version:' + uploadedFile.version + ')');
						}

						var importTemplatePromises = [];
						if (creatNewSite) {
							importTemplatePromises.push(sitesRest.importTemplate({
								server: destServer,
								name: templateName,
								fileId: fileId
							}));
						}

						return Promise.all(importTemplatePromises);
					})
					.then(function (results) {
						if (creatNewSite) {
							if (!results || !results[0] || results[0].err) {
								console.log('ERROR: failed to import template');
								return Promise.reject();
							}
						}

						var queryTemplatePromises = [];
						if (creatNewSite) {
							queryTemplatePromises.push(sitesRest.getTemplate({
								server: destServer,
								name: templateName
							}));
						}

						return Promise.all(queryTemplatePromises);
					})
					.then(function (results) {
						if (creatNewSite) {
							if (!results || !results[0] || results[0].err || !results[0].id) {
								console.log('ERROR: failed to query template');
								return Promise.reject();
							}

							templateId = results[0].id;
						}

						return serverUtils.getServerVersion(request, destServer);
					})
					.then(function (result) {
						cecVersion = result && result.version;

						return serverUtils.getIdcToken(destServer);
					})
					.then(function (result) {
						// fetch token
						if (result && result.idcToken) {
							idcToken = result && result.idcToken;
						}
						var createSitePromises = [];
						if (creatNewSite && site) {
							/*
							createSitePromises.push(sitesRest.createSite({
								server: destServer,
								name: siteName,
								description: site.description,
								sitePrefix: site.sitePrefix,
								templateName: templateName,
								templateId: templateId,
								repositoryId: repository.id,
								localizationPolicyId: policy.id,
								defaultLanguage: site.defaultLanguage
							}));
							*/
							createSitePromises.push(_postOneIdcService(request, localhost, destServer, 'SCS_COPY_SITES', 'create site', idcToken));
						}

						return Promise.all(createSitePromises);

					})
					.then(function (results) {
						if (creatNewSite) {
							if (!results || !results[0] || results[0].err) {
								actionSuccess = false;
							}
						}

						var deleteFilePromises = [];
						if (creatNewSite && fileId) {
							// delete template file
							deleteFilePromises.push(serverRest.deleteFile({
								server: destServer,
								fFileGUID: fileId
							}));
						}

						return Promise.all(deleteFilePromises);
					})
					.then(function (results) {

						var deleteTemplatePromises = [];
						if (creatNewSite && templateId) {
							// delete template
							deleteTemplatePromises.push(sitesRest.deleteTemplate({
								server: destServer,
								name: templateName,
								hard: true
							}));
						}

						return Promise.all(deleteTemplatePromises);
					})
					.then(function (results) {
						var unzipTemplatePromises = [];
						if (!creatNewSite) {
							unzipTemplatePromises.push(templateUtils.unzipTemplate(templateName, templatePath, false));
						}

						return Promise.all(unzipTemplatePromises);

					})
					.then(function (results) {
						if (creatNewSite) {
							if (actionSuccess) {
								console.log(' - site ' + siteName + ' created on ' + destServer.url);
							}
							_cmdEnd(done, actionSuccess);

						} else {
							var updateSiteArgs = {
								projectDir: projectDir,
								name: siteName,
								template: templateName,
								server: destServerName
							};
							siteUpdateLib.updateSite(updateSiteArgs, function (success) {
								console.log(' - update site finished');
								_cmdEnd(done, success);
							});
						}

					})
					.catch((error) => {
						if (error) {
							console.log(error);
						}
						_cmdEnd(done);
					});
			});
		});
};

/**
 * control site
 */
module.exports.controlSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		_cmdEnd(done);
		return;
	}

	try {

		var serverName = argv.server;
		var server = serverUtils.verifyServer(serverName, projectDir);
		if (!server || !server.valid) {
			_cmdEnd(done);
			return;
		}

		// console.log('server: ' + server.url);

		var action = argv.action;
		var siteName = argv.site;

		var request = serverUtils.getRequest();

		serverUtils.loginToServer(server, request).then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}
			if (server.useRest) {
				_controlSiteREST(request, server, action, siteName, done);
			} else {
				_controlSiteSCS(request, server, action, siteName, done);
			}
		});

	} catch (e) {
		console.log(e);
		done();
	}

};

/**
 * Use sites management API to activate / deactivate a site
 * @param {*} request 
 * @param {*} server the server object
 * @param {*} action bring-online / take-offline
 * @param {*} siteId 
 */
var _setSiteRuntimeStatus = function (request, server, action, siteId) {
	var sitePromise = new Promise(function (resolve, reject) {

		var url = server.url + '/sites/management/api/v1/sites/' + siteId + '/' + (action === 'bring-online' ? 'activate' : 'deactivate');

		var headers = {
			'Content-Type': 'application/json'
		};
		var options = {
			method: 'POST',
			url: url,
			headers: headers
		};

		if (server.env === 'pod_ec') {
			headers.Authorization = server.oauthtoken;
			options.headers = headers;
		} else {
			options.auth = {
				user: server.username,
				password: server.password
			};
		}

		request(options, function (error, response, body) {
			if (error) {
				console.log('ERROR: failed to ' + action + ' the site');
				console.log(error);
				resolve({
					err: 'err'
				});
			}

			if (response.statusCode === 303) {

				resolve({});

			} else {
				var data;
				try {
					data = JSON.parse(body);
				} catch (error) {}

				var msg = data ? (data.detail || data.title) : (response.statusMessage || response.statusCode);
				console.log('ERROR: failed to ' + action + ' the site - ' + msg);
				resolve({
					err: 'err'
				});
			}
		});
	});
	return sitePromise;
};

/**
 * Use Idc service to publish / unpublish a site
 */
var _IdcControlSite = function (request, server, action, siteId) {
	var controlPromise = new Promise(function (resolve, reject) {

		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			var express = require('express');
			var app = express();

			var port = '9191';
			var localhost = 'http://localhost:' + port;

			var dUser = '';
			var idcToken;

			var auth = serverUtils.getRequestAuth(server);

			app.get('/*', function (req, res) {
				// console.log('GET: ' + req.url);
				if (req.url.indexOf('/documents/') >= 0 || req.url.indexOf('/content/') >= 0) {
					var url = server.url + req.url;

					var options = {
						url: url,
					};

					options['auth'] = auth;

					request(options).on('response', function (response) {
							// fix headers for cross-domain and capitalization issues
							serverUtils.fixHeaders(response, res);
						})
						.on('error', function (err) {
							console.log('ERROR: GET request failed: ' + req.url);
							console.log(error);
							return resolve({
								err: 'err'
							});
						})
						.pipe(res);

				} else {
					console.log('ERROR: GET request not supported: ' + req.url);
					res.write({});
					res.end();
				}
			});
			app.post('/documents/web', function (req, res) {
				// console.log('POST: ' + req.url);
				if (req.url.indexOf('SCS_PUBLISH_SITE') > 0 || req.url.indexOf('SCS_UNPUBLISH_SITE') > 0) {
					var url = server.url + '/documents/web?IdcService=' + (req.url.indexOf('SCS_PUBLISH_SITE') > 0 ? 'SCS_PUBLISH_SITE' : 'SCS_UNPUBLISH_SITE');
					var formData = {
						'idcToken': idcToken,
						'item': 'fFolderGUID:' + siteId
					};

					var postData = {
						method: 'POST',
						url: url,
						'auth': auth,
						'formData': formData
					};

					request(postData).on('response', function (response) {
							// fix headers for cross-domain and capitalization issues
							serverUtils.fixHeaders(response, res);
						})
						.on('error', function (err) {
							console.log('ERROR: Failed to ' + action + ' site');
							console.log(error);
							return resolve({
								err: 'err'
							});
						})
						.pipe(res)
						.on('finish', function (err) {
							res.end();
						});
				} else {
					console.log('ERROR: POST request not supported: ' + req.url);
					res.write({});
					res.end();
				}
			});

			localServer = app.listen(0, function () {
				port = localServer.address().port;
				localhost = 'http://localhost:' + port;
				localServer.setTimeout(0);

				var inter = setInterval(function () {
					// console.log(' - getting login user: ' + total);
					var url = localhost + '/documents/web?IdcService=SCS_GET_TENANT_CONFIG';

					request.get(url, function (err, response, body) {
						var data = JSON.parse(body);
						dUser = data && data.LocalData && data.LocalData.dUser;
						idcToken = data && data.LocalData && data.LocalData.idcToken;
						if (dUser && dUser !== 'anonymous' && idcToken) {
							// console.log(' - dUser: ' + dUser + ' idcToken: ' + idcToken);
							clearInterval(inter);
							console.log(' - establish user session');

							url = localhost + '/documents/web?IdcService=' + (action === 'publish' ? 'SCS_PUBLISH_SITE' : 'SCS_UNPUBLISH_SITE');

							request.post(url, function (err, response, body) {
								if (err) {
									console.log('ERROR: Failed to ' + action + ' site');
									console.log(err);
									return resolve({
										err: 'err'
									});
								}

								var data;
								try {
									data = JSON.parse(body);
								} catch (e) {}

								if (!data || !data.LocalData || data.LocalData.StatusCode !== '0') {
									console.log('ERROR: failed to ' + action + ' site ' + (data && data.LocalData ? '- ' + data.LocalData.StatusMessage : ''));
									return resolve({
										err: 'err'
									});
								}

								if (action === 'unpublish') {
									return resolve({});
								} else {
									var jobId = data.LocalData.JobID;

									// wait create to finish
									var inter = setInterval(function () {
										var jobPromise = serverUtils.getBackgroundServiceJobStatus(server, request, idcToken, jobId);
										jobPromise.then(function (data) {
											if (!data || data.err || !data.JobStatus || data.JobStatus === 'FAILED') {
												clearInterval(inter);
												console.log(data);
												// try to get error message
												console.log('ERROR: ' + action + ' site failed: ' + (data && data.JobMessage));
												return resolve({
													err: 'err'
												});

											}
											if (data.JobStatus === 'COMPLETE' || data.JobPercentage === '100') {
												clearInterval(inter);

												return resolve({});

											} else {
												console.log(' - ' + action + 'ing: percentage ' + data.JobPercentage);
											}
										});
									}, 5000);
								}
							}); // publish / unpublish
						}
					}); // idc token request

				}, 6000);
			}); // local 
		}); // login
	});
	return controlPromise;
};

/**
 * Use Idc service to control a site
 */
var _controlSiteSCS = function (request, server, action, siteName, done) {

	var express = require('express');
	var app = express();

	var port = '9191';
	var localhost = 'http://localhost:' + port;

	var dUser = '';
	var idcToken;

	var auth = serverUtils.getRequestAuth(server);

	var siteId;

	app.get('/*', function (req, res) {
		// console.log('GET: ' + req.url);
		if (req.url.indexOf('/documents/') >= 0 || req.url.indexOf('/content/') >= 0) {
			var url = server.url + req.url;

			var options = {
				url: url,
			};

			options['auth'] = auth;

			request(options).on('response', function (response) {
					// fix headers for cross-domain and capitalization issues
					serverUtils.fixHeaders(response, res);
				})
				.on('error', function (err) {
					console.log('ERROR: GET request failed: ' + req.url);
					console.log(error);
					return resolve({
						err: 'err'
					});
				})
				.pipe(res);

		} else {
			console.log('ERROR: GET request not supported: ' + req.url);
			res.write({});
			res.end();
		}
	});
	app.post('/documents/web', function (req, res) {
		// console.log('POST: ' + req.url);

		var url = server.url + req.url;
		var formData = {
			'idcToken': idcToken,
			'item': 'fFolderGUID:' + siteId
		};

		if (req.url.indexOf('SCS_ACTIVATE_SITE') > 0 || req.url.indexOf('SCS_DEACTIVATE_SITE') > 0) {
			formData['isSitePublishV2'] = 1;
		}

		var postData = {
			method: 'POST',
			url: url,
			'auth': auth,
			'formData': formData
		};

		request(postData).on('response', function (response) {
				// fix headers for cross-domain and capitalization issues
				serverUtils.fixHeaders(response, res);
			})
			.on('error', function (err) {
				console.log('ERROR: Failed to ' + action + ' site');
				console.log(err);
				return resolve({
					err: 'err'
				});
			})
			.pipe(res)
			.on('finish', function (err) {
				res.end();
			});

	});

	localServer = app.listen(0, function () {
		port = localServer.address().port;
		localhost = 'http://localhost:' + port;
		localServer.setTimeout(0);

		var inter = setInterval(function () {
			// console.log(' - getting login user: ' + total);
			var url = localhost + '/documents/web?IdcService=SCS_GET_TENANT_CONFIG';

			request.get(url, function (err, response, body) {
				var data = JSON.parse(body);
				dUser = data && data.LocalData && data.LocalData.dUser;
				idcToken = data && data.LocalData && data.LocalData.idcToken;
				if (dUser && dUser !== 'anonymous' && idcToken) {
					// console.log(' - dUser: ' + dUser + ' idcToken: ' + idcToken);
					clearInterval(inter);
					console.log(' - establish user session');

					// verify site 
					var sitePromise = serverUtils.browseSitesOnServer(request, server);
					sitePromise.then(function (result) {
							if (result.err) {
								return Promise.reject();
							}

							var sites = result.data || [];
							var site;
							for (var i = 0; i < sites.length; i++) {
								if (siteName.toLowerCase() === sites[i].fFolderName.toLowerCase()) {
									site = sites[i];
									break;
								}
							}
							if (!site || !site.fFolderGUID) {
								console.log('ERROR: site ' + siteName + ' does not exist');
								return Promise.reject();
							}

							siteId = site.fFolderGUID;

							// console.log(' - xScsIsSiteActive: ' + site.xScsIsSiteActive + ' xScsSitePublishStatus: ' + site.xScsSitePublishStatus);
							var runtimeStatus = site.xScsIsSiteActive && site.xScsIsSiteActive === '1' ? 'online' : 'offline';
							var publishStatus = site.xScsSitePublishStatus && site.xScsSitePublishStatus === 'published' ? 'published' : 'unpublished';
							console.log(' - get site: runtimeStatus: ' + runtimeStatus + '  publishStatus: ' + publishStatus);

							if (action === 'take-offline' && runtimeStatus === 'offline') {
								console.log(' - site is already offline');
								return Promise.reject();
							}
							if (action === 'bring-online' && runtimeStatus === 'online') {
								console.log(' - site is already online');
								return Promise.reject();
							}
							if (action === 'bring-online' && publishStatus === 'unpublished') {
								console.log('ERROR: site ' + siteName + ' is draft, publish it first');
								return Promise.reject();
							}

							if (action === 'unpublish' && runtimeStatus === 'online') {
								console.log('ERROR: site ' + siteName + ' is online, take it offline first');
								return Promise.reject();
							}
							if (action === 'unpublish' && publishStatus === 'unpublished') {
								console.log('ERROR: site ' + siteName + ' is draft');
								return Promise.reject();
							}

							var service;
							if (action === 'publish') {
								service = 'SCS_PUBLISH_SITE';
							} else if (action === 'unpublish') {
								service = 'SCS_UNPUBLISH_SITE';
							} else if (action === 'bring-online') {
								service = 'SCS_ACTIVATE_SITE';
							} else if (action === 'take-offline') {
								service = 'SCS_DEACTIVATE_SITE';
							} else {
								console.log('ERROR: invalid action ' + action);
								return Promise.reject();
							}

							var actionPromise = _postOneIdcService(request, localhost, server, service, action, idcToken);
							actionPromise.then(function (result) {
								if (result.err) {
									_cmdEnd(done);
									return;
								}

								if (action === 'bring-online') {
									console.log(' - site ' + siteName + ' is online now');
								} else if (action === 'take-offline') {
									console.log(' - site ' + siteName + ' is offline now');
								} else {
									console.log(' - ' + action + ' ' + siteName + ' finished');
								}
								_cmdEnd(done, true);
							});
						})
						.catch((error) => {
							_cmdEnd(done);
						});
				}
			}); // idc token request

		}, 5000);
	}); // local 
};

var _postOneIdcService = function (request, localhost, server, service, action, idcToken) {
	return new Promise(function (resolve, reject) {
		// service: SCS_PUBLISH_SITE, SCS_UNPUBLISH_SITE, SCS_ACTIVATE_SITE, SCS_DEACTIVATE_SITE
		var url = localhost + '/documents/web?IdcService=' + service;

		request.post(url, function (err, response, body) {
			if (err) {
				console.log('ERROR: Failed to ' + action);
				console.log(err);
				return resolve({
					err: 'err'
				});
			}

			var data;
			try {
				data = JSON.parse(body);
			} catch (e) {}

			if (!data || !data.LocalData || data.LocalData.StatusCode !== '0') {
				console.log('ERROR: failed to ' + action + ' - ' + (data && data.LocalData ? data.LocalData.StatusMessage : response.statusMessage || response.statusCode));
				return resolve({
					err: 'err'
				});
			}

			var jobId = data.LocalData.JobID;

			if (jobId) {
				console.log(' - submit ' + action);
				// wait action to finish
				var inter = setInterval(function () {
					var jobPromise = serverUtils.getBackgroundServiceJobStatus(server, request, idcToken, jobId);
					jobPromise.then(function (data) {
						if (!data || data.err || !data.JobStatus || data.JobStatus === 'FAILED') {
							clearInterval(inter);
							// console.log(data);
							// try to get error message
							console.log('ERROR: ' + action + ' failed: ' + (data && data.JobMessage));
							serverUtils.getBackgroundServiceJobData(server, request, idcToken, jobId)
								.then(function (result) {
									// console.log(result);
									if (result && result.LocalData && result.LocalData.StatusMessage) {
										console.log(result.LocalData.StatusMessage);
									}
									return resolve({
										err: 'err'
									});
								});
						} else if (data.JobStatus === 'COMPLETE' || data.JobPercentage === '100') {
							clearInterval(inter);

							return resolve({});

						} else {
							console.log(' - ' + action + ' in process: percentage ' + data.JobPercentage);
						}
					});
				}, 6000);
			} else {
				return resolve({});
			}
		});
	});
};

var _getOneIdcService = function (request, localhost, server, service, params) {
	return new Promise(function (resolve, reject) {
		// service: SCS_GET_SITE_INFO_FILE
		var url = localhost + '/documents/web?IdcService=' + service;
		if (params) {
			url = url + '&' + params;
		}

		request.get(url, function (err, response, body) {
			if (err) {
				console.log('ERROR: Failed to do ' + service);
				console.log(err);
				return resolve({
					err: 'err'
				});
			}

			var data;
			try {
				data = JSON.parse(body);
			} catch (e) {}

			if (response && response.statusCode !== 200) {
				var msg = data && data.LocalData ? data.LocalData.StatusMessage : (response.statusMessage || response.statusCode);
				console.log('ERROR: Failed to do ' + service + ' - ' + msg);
				return resolve({
					err: 'err'
				});
			}

			return resolve(data);
		});
	});
};

/**
 * Control site using REST APIs
 * @param {*} request 
 * @param {*} server 
 * @param {*} action 
 * @param {*} siteName 
 * @param {*} done 
 */
var _controlSiteREST = function (request, server, action, siteName, done) {


	sitesRest.getSite({
			server: server,
			name: siteName
		})
		.then(function (result) {
			if (result.err) {
				return Promise.reject();
			}

			var site = result;
			var runtimeStatus = site.runtimeStatus;
			var publishStatus = site.publishStatus;
			console.log(' - get site: runtimeStatus: ' + runtimeStatus + '  publishStatus: ' + publishStatus);

			if (action === 'take-offline' && runtimeStatus === 'offline') {
				console.log(' - site is already offline');
				return Promise.reject();
			}
			if (action === 'bring-online' && runtimeStatus === 'online') {
				console.log(' - site is already online');
				return Promise.reject();
			}
			if (action === 'bring-online' && publishStatus === 'unpublished') {
				console.log('ERROR: site ' + siteName + ' is draft, publish it first');
				return Promise.reject();
			}

			if (action === 'unpublish' && runtimeStatus === 'online') {
				console.log('ERROR: site ' + siteName + ' is online, take it offline first');
				return Promise.reject();
			}
			if (action === 'unpublish' && publishStatus === 'unpublished') {
				console.log('ERROR: site ' + siteName + ' is draft');
				return Promise.reject();
			}

			var actionPromise;
			if (action === 'publish') {
				actionPromise = sitesRest.publishSite({
					server: server,
					name: siteName
				});
			} else if (action === 'unpublish') {
				actionPromise = sitesRest.unpublishSite({
					server: server,
					name: siteName
				});
			} else if (action === 'bring-online') {
				actionPromise = sitesRest.activateSite({
					server: server,
					name: siteName
				});
			} else if (action === 'take-offline') {
				actionPromise = sitesRest.deactivateSite({
					server: server,
					name: siteName
				});
			} else {
				console.log('ERROR: invalid action ' + action);
				return Promise.reject();
			}

			return actionPromise;
		})
		.then(function (result) {
			if (result.err) {
				return Promise.reject();
			}

			if (action === 'bring-online') {
				console.log(' - site ' + siteName + ' is online now');
			} else if (action === 'take-offline') {
				console.log(' - site ' + siteName + ' is offline now');
			} else {
				console.log(' - ' + action + ' ' + siteName + ' finished');
			}

			done(true);
		})
		.catch((error) => {
			done();
		});
};

/**
 * share site
 */
module.exports.shareSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		_cmdEnd(done);
		return;
	}

	try {
		var serverName = argv.server;
		var server = serverUtils.verifyServer(serverName, projectDir);
		if (!server || !server.valid) {
			_cmdEnd(done);
			return;
		}

		// console.log('server: ' + server.url);
		var name = argv.name;
		var userNames = argv.users ? argv.users.split(',') : [];
		var groupNames = argv.groups ? argv.groups.split(',') : [];
		var role = argv.role;

		var siteId;
		var users = [];
		var groups = [];

		var request = serverUtils.getRequest();

		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			var sitePromise = server.useRest ? sitesRest.getSite({
				server: server,
				name: name
			}) : serverUtils.getSiteFolderAfterLogin(server, name);
			sitePromise.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					if (!result.id) {
						console.log('ERROR: site ' + name + ' does not exist');
						return Promise.reject();
					}
					siteId = result.id;
					console.log(' - verify site');

					return serverRest.getGroups({
						server: server
					});
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					if (groupNames.length > 0) {
						console.log(' - verify groups');
					}
					// verify groups
					var allGroups = result || [];
					for (var i = 0; i < groupNames.length; i++) {
						var found = false;
						for (var j = 0; j < allGroups.length; j++) {
							if (groupNames[i].toLowerCase() === allGroups[j].name.toLowerCase()) {
								found = true;
								groups.push(allGroups[j]);
								break;
							}
						}
						if (!found) {
							console.log('ERROR: group ' + groupNames[i] + ' does not exist');
						}
					}

					var usersPromises = [];
					for (var i = 0; i < userNames.length; i++) {
						usersPromises.push(serverRest.getUser({
							server: server,
							name: userNames[i]
						}));
					}

					return Promise.all(usersPromises);
				})
				.then(function (results) {
					var allUsers = [];
					for (var i = 0; i < results.length; i++) {
						if (results[i].items) {
							allUsers = allUsers.concat(results[i].items);
						}
					}
					if (userNames.length > 0) {
						console.log(' - verify users');
					}
					// verify users
					for (var k = 0; k < userNames.length; k++) {
						var found = false;
						for (var i = 0; i < allUsers.length; i++) {
							if (allUsers[i].loginName && allUsers[i].loginName.toLowerCase() === userNames[k].toLowerCase()) {
								users.push(allUsers[i]);
								found = true;
								break;
							}
							if (found) {
								break;
							}
						}
						if (!found) {
							console.log('ERROR: user ' + userNames[k] + ' does not exist');
						}
					}

					if (users.length === 0 && groups.length === 0) {
						return Promise.reject();
					}

					return serverRest.getFolderUsers({
						server: server,
						id: siteId
					});
				})
				.then(function (result) {
					var existingMembers = result.data || [];

					var sharePromises = [];
					for (var i = 0; i < users.length; i++) {
						var newMember = true;
						for (var j = 0; j < existingMembers.length; j++) {
							if (existingMembers[j].id === users[i].id) {
								newMember = false;
								break;
							}
						}
						// console.log(' - user: ' + users[i].loginName + ' new grant: ' + newMember);
						sharePromises.push(serverRest.shareFolder({
							server: server,
							id: siteId,
							userId: users[i].id,
							role: role,
							create: newMember
						}));
					}

					for (var i = 0; i < groups.length; i++) {
						var newMember = true;
						for (var j = 0; j < existingMembers.length; j++) {
							if (existingMembers[j].id === groups[i].groupID) {
								newMember = false;
								break;
							}
						}
						// console.log(' - group: ' + (groups[i].displayName || groups[i].name) + ' new grant: ' + newMember);
						sharePromises.push(serverRest.shareFolder({
							server: server,
							id: siteId,
							userId: groups[i].groupID,
							role: role,
							create: newMember
						}));
					}

					return Promise.all(sharePromises);
				})
				.then(function (results) {
					var shared = false;
					for (var i = 0; i < results.length; i++) {
						if (results[i].errorCode === '0') {
							shared = true;
							var typeLabel = results[i].user.loginName ? 'user' : 'group';
							console.log(' - ' + typeLabel + ' ' + (results[i].user.loginName || results[i].user.displayName) + ' granted "' +
								results[i].role + '" on site ' + name);
						} else {
							console.log('ERROR: ' + results[i].title);
						}
					}
					_cmdEnd(done, shared);
				})
				.catch((error) => {
					_cmdEnd(done);
				});
		}); // login
	} catch (e) {
		_cmdEnd(done);
	}
};

/**
 * share site
 */
module.exports.unshareSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		_cmdEnd(done);
		return;
	}

	try {
		var serverName = argv.server;
		var server = serverUtils.verifyServer(serverName, projectDir);
		if (!server || !server.valid) {
			_cmdEnd(done);
			return;
		}

		// console.log('server: ' + server.url);
		var name = argv.name;
		var userNames = argv.users ? argv.users.split(',') : [];
		var groupNames = argv.groups ? argv.groups.split(',') : [];

		var siteId;
		var users = [];
		var groups = [];

		var request = serverUtils.getRequest();

		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			var sitePromise = server.useRest ? sitesRest.getSite({
				server: server,
				name: name
			}) : serverUtils.getSiteFolderAfterLogin(server, name);
			sitePromise.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					if (!result.id) {
						console.log('ERROR: site ' + name + ' does not exist');
						return Promise.reject();
					}
					siteId = result.id;
					console.log(' - verify site');

					return serverRest.getGroups({
						server: server
					});
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					if (groupNames.length > 0) {
						console.log(' - verify groups');
					}
					// verify groups
					var allGroups = result || [];
					for (var i = 0; i < groupNames.length; i++) {
						var found = false;
						for (var j = 0; j < allGroups.length; j++) {
							if (groupNames[i].toLowerCase() === allGroups[j].name.toLowerCase()) {
								found = true;
								groups.push(allGroups[j]);
								break;
							}
						}
						if (!found) {
							console.log('ERROR: group ' + groupNames[i] + ' does not exist');
						}
					}

					var usersPromises = [];
					for (var i = 0; i < userNames.length; i++) {
						usersPromises.push(serverRest.getUser({
							server: server,
							name: userNames[i]
						}));
					}

					return Promise.all(usersPromises);
				})
				.then(function (results) {
					var allUsers = [];
					for (var i = 0; i < results.length; i++) {
						if (results[i].items) {
							allUsers = allUsers.concat(results[i].items);
						}
					}
					if (userNames.length > 0) {
						console.log(' - verify users');
					}
					// verify users
					for (var k = 0; k < userNames.length; k++) {
						var found = false;
						for (var i = 0; i < allUsers.length; i++) {
							if (allUsers[i].loginName.toLowerCase() === userNames[k].toLowerCase()) {
								users.push(allUsers[i]);
								found = true;
								break;
							}
							if (found) {
								break;
							}
						}
						if (!found) {
							console.log('ERROR: user ' + userNames[k] + ' does not exist');
						}
					}

					if (users.length === 0 && groups.length === 0) {
						return Promise.reject();
					}

					return serverRest.getFolderUsers({
						server: server,
						id: siteId
					});
				})
				.then(function (result) {
					var existingMembers = result.data || [];
					var revokePromises = [];
					for (var i = 0; i < users.length; i++) {
						var existingUser = false;
						for (var j = 0; j < existingMembers.length; j++) {
							if (users[i].id === existingMembers[j].id) {
								existingUser = true;
								break;
							}
						}

						if (existingUser) {
							revokePromises.push(serverRest.unshareFolder({
								server: server,
								id: siteId,
								userId: users[i].id
							}));
						} else {
							console.log(' - user ' + users[i].loginName + ' has no access to the site');
						}
					}

					for (var i = 0; i < groups.length; i++) {
						var existingUser = false;
						for (var j = 0; j < existingMembers.length; j++) {
							if (existingMembers[j].id === groups[i].groupID) {
								existingUser = true;
								break;
							}
						}

						if (existingUser) {
							revokePromises.push(serverRest.unshareFolder({
								server: server,
								id: siteId,
								userId: groups[i].groupID
							}));
						} else {
							console.log(' - group ' + (groups[i].displayName || groups[i].name) + ' has no access to the site');
						}
					}

					return Promise.all(revokePromises);
				})
				.then(function (results) {
					var unshared = false;
					for (var i = 0; i < results.length; i++) {
						if (results[i].errorCode === '0') {
							unshared = true;
							var typeLabel = results[i].user.loginName ? 'user' : 'group';
							console.log(' - ' + typeLabel + ' ' + (results[i].user.loginName || results[i].user.displayName) + '\'s access to the site removed');
						} else {
							console.log('ERROR: ' + results[i].title);
						}
					}
					_cmdEnd(done, unshared);
				})
				.catch((error) => {
					_cmdEnd(done);
				});
		}); // login
	} catch (e) {
		_cmdEnd(done);
	}
};


/**
 * validate site
 */
module.exports.validateSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		_cmdEnd(done);
		return;
	}

	try {

		var serverName = argv.server;
		var server = serverUtils.verifyServer(serverName, projectDir);
		if (!server || !server.valid) {
			_cmdEnd(done);
			return;
		}

		var siteName = argv.name;

		var request = serverUtils.getRequest();

		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			if (server.useRest) {
				_validateSiteREST(request, server, siteName, done);
				return;
			}

			var express = require('express');
			var app = express();

			var port = '9191';
			var localhost = 'http://localhost:' + port;

			var dUser = '';
			var idcToken;

			var auth = serverUtils.getRequestAuth(server);

			var siteId;
			var repositoryId, channelId, channelToken;

			app.get('/*', function (req, res) {
				// console.log('GET: ' + req.url);
				if (req.url.indexOf('/documents/') >= 0 || req.url.indexOf('/content/') >= 0) {
					var url = server.url + req.url;

					var options = {
						url: url,
					};

					options['auth'] = auth;

					request(options).on('response', function (response) {
							// fix headers for cross-domain and capitalization issues
							serverUtils.fixHeaders(response, res);
						})
						.on('error', function (err) {
							console.log('ERROR: GET request failed: ' + req.url);
							console.log(error);
							return resolve({
								err: 'err'
							});
						})
						.pipe(res);

				} else {
					console.log('ERROR: GET request not supported: ' + req.url);
					res.write({});
					res.end();
				}
			});

			localServer = app.listen(0, function () {
				port = localServer.address().port;
				localhost = 'http://localhost:' + port;
				localServer.setTimeout(0);

				var inter = setInterval(function () {
					// console.log(' - getting login user: ' + total);
					var url = localhost + '/documents/web?IdcService=SCS_GET_TENANT_CONFIG';

					request.get(url, function (err, response, body) {
						var data = JSON.parse(body);
						dUser = data && data.LocalData && data.LocalData.dUser;
						idcToken = data && data.LocalData && data.LocalData.idcToken;
						if (dUser && dUser !== 'anonymous' && idcToken) {
							// console.log(' - dUser: ' + dUser + ' idcToken: ' + idcToken);
							clearInterval(inter);
							console.log(' - establish user session');

							// verify site 
							var sitePromise = serverUtils.browseSitesOnServer(request, server);
							sitePromise.then(function (result) {
									if (result.err) {
										return Promise.reject();
									}

									var sites = result.data || [];
									var site;
									for (var i = 0; i < sites.length; i++) {
										if (siteName.toLowerCase() === sites[i].fFolderName.toLowerCase()) {
											site = sites[i];
											break;
										}
									}
									if (!site || !site.fFolderGUID) {
										console.log('ERROR: site ' + siteName + ' does not exist');
										return Promise.reject();
									}

									if (site.isEnterprise !== '1') {
										console.log(' - site ' + siteName + ' is not an enterprise site');
										return Promise.reject();
									}

									siteId = site.fFolderGUID;

									// get other site info
									return _getOneIdcService(request, localhost, server, 'SCS_GET_SITE_INFO_FILE', 'siteId=' + siteName + '&IsJson=1');
								})
								.then(function (result) {
									if (result.err) {
										return Promise.reject();
									}

									var site = result.base ? result.base.properties : undefined;
									if (!site || !site.siteName) {
										console.log('ERROR: failed to get site info');
										return Promise.reject();
									}

									if (!site.defaultLanguage) {
										console.log(' - site ' + siteName + ' is not configured with a default language');
										return Promise.reject();
									}

									var tokens = site.channelAccessTokens;
									for (var i = 0; i < tokens.length; i++) {
										if (tokens[i].name === 'defaultToken') {
											channelToken = tokens[i].value;
											break;
										}
									}
									if (!channelToken && tokens.length > 0) {
										channelToken = tokens[0].value;
									}

									repositoryId = site.repositoryId;
									channelId = site.channelId;
									console.log(' - get site');
									console.log('   repository: ' + repositoryId);
									console.log('   channel: ' + channelId);
									console.log('   channelToken: ' + channelToken);
									console.log('   defaultLanguage: ' + site.defaultLanguage);

									var params = 'item=fFolderGUID:' + siteId;
									return _getOneIdcService(request, localhost, server, 'SCS_VALIDATE_SITE_PUBLISH', params);
								})
								.then(function (result) {
									if (result.err) {
										return Promise.reject();
									}

									var siteValidation;
									try {
										siteValidation = JSON.parse(result.LocalData && result.LocalData.SiteValidation);
									} catch (e) {}

									if (!siteValidation) {
										console.log('ERROR: failed to get site validation');
										return Promise.reject();
									}
									// console.log(siteValidation);
									console.log('Site Validation:');
									_displaySiteValidation(siteValidation);

									// query channel items
									return serverRest.getChannelItems({
										server: server,
										channelToken: channelToken
									});
								})
								.then(function (result) {
									var items = result || [];
									if (items.length === 0) {
										console.log('Assets Validation:');
										console.log('  no assets');
										return Promise.reject();
									}

									var itemIds = [];
									for (var i = 0; i < items.length; i++) {
										var item = items[i];
										itemIds.push(item.id);
									}

									// validate assets
									return serverRest.validateChannelItems({
										server: server,
										channelId: channelId,
										itemIds: itemIds
									});
								})
								.then(function (result) {
									if (result.err) {
										return Promise.reject();
									}

									console.log('Assets Validation:');
									if (result.data && result.data.operations && result.data.operations.validatePublish) {
										var assetsValidation = result.data.operations.validatePublish.validationResults;
										_displayAssetValidation(assetsValidation);
									} else {
										console.log('  no assets');
									}
									_cmdEnd(done, localServer, true);
								})
								.catch((error) => {
									_cmdEnd(done, localServer);
								});
						}
					}); // idc token request

				}, 6000);
			}); // local 
		}); // login
	} catch (e) {
		console.log(e);
		_cmdEnd(done);
	}
};

var _displaySiteValidation = function (validation) {
	console.log('  is valid: ' + validation.valid);

	if (validation.valid) {
		return;
	}

	var format = '  %-12s : %-s';

	var pages = validation.pages;
	for (var i = 0; i < pages.length; i++) {
		if (!pages[i].publishable) {
			console.log(sprintf(format, 'page name', pages[i].name));
			for (var k = 0; k < pages[i].languages.length; k++) {
				var lang = pages[i].languages[k];
				var msg = lang.validation + ' ' + lang.policyStatus + ' language ' + lang.language;
				console.log(sprintf(format, (k === 0 ? 'languages' : ' '), msg));
			}
		}
	}
};

var _displayAssetValidation = function (validations) {
	var policyValidation;
	for (var i = 0; i < validations.length; i++) {
		var val = validations[i];
		Object.keys(val).forEach(function (key) {
			if (key === 'policyValidation') {
				policyValidation = val[key];
			}
		});
	}

	var format = '  %-12s : %-s';

	var items = policyValidation.items;
	var valid = true;
	for (var i = 0; i < items.length; i++) {
		var val = items[i].validations;

		for (var j = 0; j < val.length; j++) {
			if (!val[j].publishable) {
				valid = false;
				console.log(sprintf(format, 'name', items[i].name));
				console.log(sprintf(format, 'type', items[i].type));
				console.log(sprintf(format, 'language', items[i].language));

				var results = val[j].results;
				for (var k = 0; k < results.length; k++) {
					// console.log(results[k]);
					// results[k].value is the policy languages
					console.log(sprintf(format, 'item id', results[k].itemId));
					console.log(sprintf(format, 'valid', results[k].valid));
					console.log(sprintf(format, 'message', results[k].message));
				}
				console.log('');
			}
		}
	}
	if (valid) {
		console.log('  is valid: ' + valid);
	}

};

var _validateSiteREST = function (request, server, siteName, done) {
	var siteId;
	var repositoryId, channelId, channelToken;
	sitesRest.getSite({
			server: server,
			name: siteName,
			expand: 'channel,repository'
		})
		.then(function (result) {
			if (!result || result.err) {
				return Promise.reject();
			}

			var site = result;
			if (!site.isEnterprise) {
				console.log(' - site ' + siteName + ' is not an enterprise site');
				return Promise.reject();
			}
			if (!site.defaultLanguage) {
				console.log(' - site ' + siteName + ' is not configured with a default language');
				return Promise.reject();
			}

			siteId = site.id;
			repositoryId = site.repository && site.repository.id;
			channelId = site.channel && site.channel.id;

			var tokens = site.channel && site.channel.channelTokens || [];
			for (var i = 0; i < tokens.length; i++) {
				if (tokens[i].name === 'defaultToken') {
					channelToken = tokens[i].token;
					break;
				}
			}
			if (!channelToken && tokens.length > 0) {
				channelToken = tokens[0].value;
			}

			console.log(' - get site');
			console.log('   repository: ' + repositoryId);
			console.log('   channel: ' + channelId);
			console.log('   channelToken: ' + channelToken);
			console.log('   defaultLanguage: ' + site.defaultLanguage);

			return sitesRest.validateSite({
				server: server,
				name: siteName
			});
		})
		.then(function (result) {
			if (!result || result.err) {
				return Promise.reject();
			}
			var siteValidation = result;
			console.log('Site Validation:');
			_displaySiteValidation(siteValidation);

			// query channel items
			return serverRest.getChannelItems({
				server: server,
				channelToken: channelToken
			});
		})
		.then(function (result) {
			var items = result || [];
			if (items.length === 0) {
				console.log('Assets Validation:');
				console.log('  no assets');
				return Promise.reject();
			}

			var itemIds = [];
			for (var i = 0; i < items.length; i++) {
				var item = items[i];
				itemIds.push(item.id);
			}

			// validate assets
			return serverRest.validateChannelItems({
				server: server,
				channelId: channelId,
				itemIds: itemIds
			});
		})
		.then(function (result) {
			if (result.err) {
				return Promise.reject();
			}

			console.log('Assets Validation:');
			if (result.data && result.data.operations && result.data.operations.validatePublish) {
				var assetsValidation = result.data.operations.validatePublish.validationResults;
				_displayAssetValidation(assetsValidation);
			} else {
				console.log('  no assets');
			}

			done(true);
		})
		.catch((error) => {
			done();
		});
};

/**
 * set site security
 */
module.exports.setSiteSecurity = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		_cmdEnd(done);
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		_cmdEnd(done);
		return;
	}

	// console.log('server: ' + server.url);
	var name = argv.name;
	var signin = argv.signin;
	var access = argv.access;
	var addUserNames = argv.addusers ? argv.addusers.split(',') : [];
	var deleteUserNames = argv.deleteusers ? argv.deleteusers.split(',') : [];

	if (signin === 'no') {
		if (access) {
			console.log(' - ignore argument <access>');
		}
		if (addUserNames.length > 0) {
			console.log(' - ignore argument <addusers>');
		}
		if (deleteUserNames.length > 0) {
			console.log(' - ignore argument <deleteusers>');
		}
	} else {
		for (var i = 0; i < deleteUserNames.length; i++) {
			for (var j = 0; j < addUserNames.length; j++) {
				if (deleteUserNames[i].toLowerCase() === addUserNames[j].toLowerCase()) {
					console.log('ERROR: user ' + deleteUserNames[i] + ' in both <addusers> and <deleteusers>');
					_cmdEnd(done);
					return;
				}
			}
		}
	}

	if (server.useRest) {
		_setSiteSecurityREST(server, name, signin, access, addUserNames, deleteUserNames, done);
	} else {
		_setSiteSecuritySCS(server, name, signin, access, addUserNames, deleteUserNames, done);
	}
};

var _setSiteSecuritySCS = function (server, name, signin, access, addUserNames, deleteUserNames, done) {
	try {
		var request = serverUtils.getRequest();

		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			var express = require('express');
			var app = express();

			var port = '9191';
			var localhost = 'http://localhost:' + port;

			var dUser = '';
			var idcToken;

			var auth = serverUtils.getRequestAuth(server);

			var site, siteId;
			var siteUsers = [];
			var siteSecured;
			var xScsIsSecureSiteNew;
			var users = [];

			app.get('/*', function (req, res) {
				// console.log('GET: ' + req.url);
				if (req.url.indexOf('/documents/') >= 0 || req.url.indexOf('/content/') >= 0) {
					var url = server.url + req.url;

					var options = {
						url: url,
					};

					options['auth'] = auth;

					request(options).on('response', function (response) {
							// fix headers for cross-domain and capitalization issues
							serverUtils.fixHeaders(response, res);
						})
						.on('error', function (err) {
							console.log('ERROR: GET request failed: ' + req.url);
							console.log(error);
							return resolve({
								err: 'err'
							});
						})
						.pipe(res);

				} else {
					console.log('ERROR: GET request not supported: ' + req.url);
					res.write({});
					res.end();
				}
			});
			app.post('/documents/web', function (req, res) {
				// console.log('POST: ' + req.url);
				var url = server.url + req.url;

				var userList = '';
				for (var i = 0; i < users.length; i++) {
					var action = users[i].action === 'add' ? 'A' : 'D';
					if (userList) {
						userList = userList + ',';
					}
					userList = userList + users[i].loginName + ':' + action;
				}
				var formData = {
					'idcToken': idcToken,
					'item': 'fFolderGUID:' + siteId,
					'xScsIsSecureSite': xScsIsSecureSiteNew
				};
				if (userList) {
					formData['userList'] = userList;
				}
				var postData = {
					method: 'POST',
					url: url,
					auth: auth,
					formData: formData
				};

				request(postData).on('response', function (response) {
						// fix headers for cross-domain and capitalization issues
						serverUtils.fixHeaders(response, res);
					})
					.on('error', function (err) {
						console.log('ERROR: Failed to update site security settings');
						console.log(error);
						return resolve({
							err: 'err'
						});
					})
					.pipe(res)
					.on('finish', function (err) {
						res.end();
					});

			});

			localServer = app.listen(0, function () {
				port = localServer.address().port;
				localhost = 'http://localhost:' + port;
				localServer.setTimeout(0);

				var inter = setInterval(function () {
					// console.log(' - getting login user: ');
					var url = localhost + '/documents/web?IdcService=SCS_GET_TENANT_CONFIG';

					request.get(url, function (err, response, body) {
						var data = JSON.parse(body);
						dUser = data && data.LocalData && data.LocalData.dUser;
						idcToken = data && data.LocalData && data.LocalData.idcToken;
						if (dUser && dUser !== 'anonymous' && idcToken) {
							// console.log(' - dUser: ' + dUser + ' idcToken: ' + idcToken);
							clearInterval(inter);
							console.log(' - establish user session');

							// verify site 
							var sitePromise = serverUtils.browseSitesOnServer(request, server);
							sitePromise.then(function (result) {
									if (result.err) {
										return Promise.reject();
									}
									var sites = result.data || [];
									for (var i = 0; i < sites.length; i++) {
										if (name.toLowerCase() === sites[i].fFolderName.toLowerCase()) {
											site = sites[i];
											break;
										}
									}

									if (!site || !site.fFolderGUID) {
										console.log('ERROR: site ' + name + ' does not exist');
										return Promise.reject();
									}

									siteId = site.fFolderGUID;
									var siteOnline = site.xScsIsSiteActive === '1' ? true : false;
									siteSecured = !site.xScsIsSecureSite || site.xScsIsSecureSite === '' || site.xScsIsSecureSite === '0' ? false : true;
									console.log(' - get site: runtimeStatus: ' + (siteOnline ? 'online' : 'offline') + ' securityStatus: ' + (siteSecured ? 'secured' : 'public'));

									if (signin === 'no' && !siteSecured) {
										console.log(' - site is already publicly available to anyone');
										return Promise.reject();
									}
									if (siteOnline) {
										console.log('ERROR: site is currently online. In order to change the security setting you must first bring this site offline.');
										return Promise.reject();
									}

									var usersPromises = [];
									if (signin === 'yes') {
										// console.log(' - add user: ' + addUserNames);
										// console.log(' - delete user: ' + deleteUserNames);
										for (var i = 0; i < addUserNames.length; i++) {
											usersPromises.push(serverRest.getUser({
												server: server,
												name: addUserNames[i]
											}));
										}
										for (var i = 0; i < deleteUserNames.length; i++) {
											usersPromises.push(serverRest.getUser({
												server: server,
												name: deleteUserNames[i]
											}));
										}
									}
									return Promise.all(usersPromises);

								})
								.then(function (results) {
									if (signin === 'yes') {
										if (addUserNames.length > 0 || deleteUserNames.length > 0) {
											var allUsers = [];
											for (var i = 0; i < results.length; i++) {
												if (results[i].items) {
													allUsers = allUsers.concat(results[i].items);
												}
											}

											console.log(' - verify users');
											// verify users
											for (var k = 0; k < addUserNames.length; k++) {
												var found = false;
												for (var i = 0; i < allUsers.length; i++) {
													if (allUsers[i].loginName.toLowerCase() === addUserNames[k].toLowerCase()) {
														var user = allUsers[i];
														user['action'] = 'add';
														users.push(allUsers[i]);
														found = true;
														break;
													}
													if (found) {
														break;
													}
												}
												if (!found) {
													console.log('ERROR: user ' + addUserNames[k] + ' does not exist');
												}
											}
											for (var k = 0; k < deleteUserNames.length; k++) {
												var found = false;
												for (var i = 0; i < allUsers.length; i++) {
													if (allUsers[i].loginName.toLowerCase() === deleteUserNames[k].toLowerCase()) {
														var user = allUsers[i];
														user['action'] = 'delete';
														users.push(allUsers[i]);
														found = true;
														break;
													}
													if (found) {
														break;
													}
												}
												if (!found) {
													console.log('ERROR: user ' + deleteUserNames[k] + ' does not exist');
												}
											}

											if (users.length === 0) {
												return Promise.reject();
											}
										}
									}
									// console.log(users);

									xScsIsSecureSiteNew = signin === 'no' ? 0 : (!siteSecured || access ? _setSiteAccessValue(access) : parseInt(site.xScsIsSecureSite));
									// console.log(' - site.xScsIsSecureSite: ' + site.xScsIsSecureSite + ' new access code ' + xScsIsSecureSiteNew);
									return _postOneIdcService(request, localhost, server, 'SCS_EDIT_SECURE_SITE', 'update site security setting', idcToken);

								})
								.then(function (results) {
									if (result.err) {
										return Promise.reject();
									}

									var params = 'item=fFolderGUID:' + siteId;
									var getSiteUsersPromises = [];
									if (signin === 'yes') {
										getSiteUsersPromises.push(_getOneIdcService(request, localhost, server, 'SCS_GET_SECURE_SITE_USERS', params));
									}

									return Promise.all(getSiteUsersPromises);
								})
								.then(function (results) {
									if (signin === 'yes' && results.length > 0) {
										var data = results[0];
										var fields = data.ResultSets && data.ResultSets.SecureSiteUsers && data.ResultSets.SecureSiteUsers.fields || [];
										var rows = data.ResultSets && data.ResultSets.SecureSiteUsers && data.ResultSets.SecureSiteUsers.rows || [];

										for (var j = 0; j < rows.length; j++) {
											siteUsers.push({});
										}

										for (var i = 0; i < fields.length; i++) {
											var attr = fields[i].name;
											for (var j = 0; j < rows.length; j++) {
												siteUsers[j][attr] = rows[j][i];
											}
										}
										// console.log(siteUsers);

										var siteUserNames = [];
										for (var i = 0; i < siteUsers.length; i++) {
											siteUserNames.push(siteUsers[i].dUserIDLoginName);
										}
									}

									console.log(' - site security settings updated:');
									var format = '   %-50s %-s';
									console.log(sprintf(format, 'Site', name));
									console.log(sprintf(format, 'Require everyone to sign in to access', signin));
									if (signin === 'yes') {
										console.log(sprintf(format, 'Who can access this site when it goes online', ''));
										var accessValues = _getSiteAccessValues(xScsIsSecureSiteNew);
										var format2 = '           %-2s  %-s';
										var access = 'Cloud users';
										var checked = accessValues.indexOf(access) >= 0 ? '√' : '';
										console.log(sprintf(format2, checked, access));

										access = 'Visitors';
										checked = accessValues.indexOf(access) >= 0 ? '√' : '';
										console.log(sprintf(format2, checked, access));

										var access = 'Service users';
										var checked = accessValues.indexOf(access) >= 0 ? '√' : '';
										console.log(sprintf(format2, checked, access));

										var access = 'Specific users';
										var checked = accessValues.indexOf(access) >= 0 ? '√' : '';
										console.log(sprintf(format2, checked, access));

										if (accessValues.indexOf('Specific users') >= 0) {
											console.log(sprintf(format, 'Published site viewers', ''));
											console.log(sprintf('           %-s', siteUserNames.length === 0 ? '' : siteUserNames.join(', ')));
										}
									}

									_cmdEnd(done, true);
								})
								.catch((error) => {
									_cmdEnd(done);
								});
						}
					}); // idc token
				}, 5000);
			}); // local
		});
	} catch (e) {
		console.log(e);
		_cmdEnd(done);
	}
};

var siteAccessMap = [{
		code: 30,
		groups: ['Cloud users', 'Visitors', 'Service users', 'Specific users']
	},
	{
		code: 22,
		groups: ['Visitors', 'Service users', 'Specific users']
	}, {
		code: 6,
		groups: ['Visitors', 'Service users']
	}, {
		code: 18,
		groups: ['Visitors', 'Specific users']
	}, {
		code: 20,
		groups: ['Service users', 'Specific users']
	}, {
		code: 2,
		groups: ['Visitors']
	},
	{
		code: 4,
		groups: ['Service users']
	}, {
		code: 16,
		groups: ['Specific users']
	}
];

var _getSiteAccessValues = function (xScsIsSecureSite) {
	var code = parseInt(xScsIsSecureSite);
	var groups = [];
	for (var i = 0; i < siteAccessMap.length; i++) {
		if (siteAccessMap[i].code === code) {
			groups = siteAccessMap[i].groups;
			break;
		}
	}
	if (groups && groups.length > 0) {
		return groups.join(', ');
	} else {
		console.log('ERROR: invalid site security value: ' + xScsIsSecureSite);
		return '';
	}
};

var _setSiteAccessValue = function (siteAccess) {
	val = 30;
	if (!siteAccess) {
		return val;
	}
	var accessArray = [];
	if (siteAccess.indexOf('Cloud users') >= 0) {
		accessArray.push('Cloud users');
	}
	if (siteAccess.indexOf('Visitors') >= 0) {
		accessArray.push('Visitors');
	}
	if (siteAccess.indexOf('Service users') >= 0) {
		accessArray.push('Service users');
	}
	if (siteAccess.indexOf('Specific users') >= 0) {
		accessArray.push('Specific users');
	}
	var accStr = accessArray.join(',');
	for (var i = 0; i < siteAccessMap.length; i++) {
		if (siteAccessMap[i].groups.join(',') === accStr) {
			val = siteAccessMap[i].code;
			break;
		}
	}
	// console.log(' - access: ' + siteAccess + ' code: ' + val);
	return val;
};

var _setSiteSecurityREST = function (server, name, signin, access, addUserNames, deleteUserNames, done) {
	try {
		var request = serverUtils.getRequest();

		var loginPromise = serverUtils.loginToServer(server, request);
		loginPromise.then(function (result) {
			if (!result.status) {
				console.log(' - failed to connect to the server');
				done();
				return;
			}

			var siteId;
			var siteSecurity;
			var siteMembers = [];
			var users = [];
			var accessValues = [];

			sitesRest.getSite({
					server: server,
					name: name,
					expand: 'access'
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					// console.log(result);
					var site = result;
					siteId = site.id;
					var siteOnline = site.runtimeStatus === 'online' ? true : false;
					siteSecurity = site.security && site.security.access || [];
					var siteSecured = siteSecurity.includes('everyone') ? false : true;
					console.log(' - get site: runtimeStatus: ' + site.runtimeStatus + ' securityStatus: ' + (siteSecured ? 'secured' : 'public'));

					if (signin === 'no' && !siteSecured) {
						console.log(' - site is already publicly available to anyone');
						return Promise.reject();
					}
					if (siteOnline) {
						console.log('ERROR: site is currently online. In order to change the security setting you must first bring this site offline.');
						return Promise.reject();
					}

					if (site.access && site.access.items && site.access.items.length > 0) {
						for (var i = 0; i < site.access.items.length; i++) {
							siteMembers.push(site.access.items[i].name);
						}
					}

					var usersPromises = [];
					if (signin === 'yes') {
						// console.log(' - add user: ' + addUserNames);
						// console.log(' - delete user: ' + deleteUserNames);
						for (var i = 0; i < addUserNames.length; i++) {
							usersPromises.push(serverRest.getUser({
								server: server,
								name: addUserNames[i]
							}));
						}
						for (var i = 0; i < deleteUserNames.length; i++) {
							usersPromises.push(serverRest.getUser({
								server: server,
								name: deleteUserNames[i]
							}));
						}
					}
					return Promise.all(usersPromises);

				})
				.then(function (results) {
					if (signin === 'yes') {
						if (addUserNames.length > 0 || deleteUserNames.length > 0) {
							var allUsers = [];
							for (var i = 0; i < results.length; i++) {
								if (results[i].items) {
									allUsers = allUsers.concat(results[i].items);
								}
							}

							console.log(' - verify users');
							var err = false;
							// verify users
							for (var k = 0; k < addUserNames.length; k++) {
								var found = false;
								for (var i = 0; i < allUsers.length; i++) {
									if (allUsers[i].loginName.toLowerCase() === addUserNames[k].toLowerCase()) {
										if (!siteMembers.includes(allUsers[i].loginName)) {
											var user = allUsers[i];
											user['action'] = 'add';
											users.push(allUsers[i]);
										}
										found = true;
										break;
									}
									if (found) {
										break;
									}
								}
								if (!found) {
									console.log('ERROR: user ' + addUserNames[k] + ' does not exist');
									err = true;
								}
							}
							for (var k = 0; k < deleteUserNames.length; k++) {
								var found = false;
								for (var i = 0; i < allUsers.length; i++) {
									if (allUsers[i].loginName.toLowerCase() === deleteUserNames[k].toLowerCase()) {
										if (siteMembers.includes(allUsers[i].loginName)) {
											var user = allUsers[i];
											user['action'] = 'delete';
											users.push(allUsers[i]);
										}
										found = true;
										break;
									}
									if (found) {
										break;
									}
								}
								if (!found) {
									console.log('ERROR: user ' + deleteUserNames[k] + ' does not exist');
									err = true;
								}
							}

							if (err && users.length === 0) {
								return Promise.reject();
							}
						}
					}

					if (access.includes('Cloud users')) {
						accessValues.push('cloud');
						accessValues.push('visitors');
						accessValues.push('service');
						accessValues.push('named');
					} else {
						if (access.includes('Visitors')) {
							accessValues.push('visitors');
						}
						if (access.includes('Service users')) {
							accessValues.push('service');
						}
						if (access.includes('Specific users')) {
							accessValues.push('named');
						}
					}

					return sitesRest.setSiteRuntimeAccess({
						server: server,
						id: siteId,
						accessList: accessValues
					});
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					// console.log(result);

					var removeAccessPromises = [];
					if (accessValues.includes('named')) {
						for (var i = 0; i < users.length; i++) {
							if (users[i].action === 'delete') {
								removeAccessPromises.push(sitesRest.removeSiteAccess({
									server: server,
									id: siteId,
									member: 'user:' + users[i].loginName
								}));
							}
						}
					}
					return Promise.all(removeAccessPromises);
				})
				.then(function (results) {

					var grantAccessPromises = [];
					if (accessValues.includes('named')) {
						for (var i = 0; i < users.length; i++) {
							if (users[i].action === 'add') {
								grantAccessPromises.push(sitesRest.grantSiteAccess({
									server: server,
									id: siteId,
									member: 'user:' + users[i].loginName
								}));
							}
						}
					}

					return Promise.all(grantAccessPromises);

				})
				.then(function (results) {

					if (!accessValues.includes('named') && users.length > 0) {
						console.log(' - add or remove memeber is not allowed when \'Specific users\' is not selected for site');
					}

					// query once more to get the final data
					return sitesRest.getSite({
						server: server,
						id: siteId,
						expand: 'access'
					});
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}

					var site = result;
					console.log(' - site security settings updated:');
					var format = '   %-50s %-s';
					console.log(sprintf(format, 'Site', name));
					console.log(sprintf(format, 'Require everyone to sign in to access', signin));
					if (signin === 'yes') {
						console.log(sprintf(format, 'Who can access this site when it goes online', ''));
						var accValues = site.security && site.security.access || [];
						// console.log(accValues);

						var format2 = '           %-2s  %-s';
						var access = 'Cloud users';
						var checked = accValues.includes('cloud') ? '√' : '';
						console.log(sprintf(format2, checked, access));

						access = 'Visitors';
						checked = accValues.includes('visitors') ? '√' : '';
						console.log(sprintf(format2, checked, access));

						var access = 'Service users';
						var checked = accValues.includes('service') ? '√' : '';
						console.log(sprintf(format2, checked, access));

						var access = 'Specific users';
						var checked = accValues.includes('named') ? '√' : '';
						console.log(sprintf(format2, checked, access));

						if (accValues.indexOf('named') >= 0) {
							var siteUserNames = [];
							if (site.access && site.access.items && site.access.items.length > 0) {
								for (var i = 0; i < site.access.items.length; i++) {
									siteUserNames.push(site.access.items[i].displayName || site.access.items[i].name);
								}
							}
							console.log(sprintf(format, 'Published site viewers', ''));
							console.log(sprintf('           %-s', siteUserNames.length === 0 ? '' : siteUserNames.join(', ')));
						}
					}

					done(true);
				})
				.catch((error) => {
					done();
				});
		});
	} catch (e) {
		console.log(e);
		done();
	}
};

/**
 * Upload static files to a site
 */
module.exports.uploadStaticSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}

	var srcPath = argv.path;

	if (!path.isAbsolute(srcPath)) {
		srcPath = path.join(projectDir, srcPath);
	}
	srcPath = path.resolve(srcPath);

	if (!fs.existsSync(srcPath)) {
		console.log('ERROR: folder ' + srcPath + ' does not exist');
		done();
		return;
	}
	if (!fs.statSync(srcPath).isDirectory()) {
		console.log('ERROR: ' + srcPath + ' is not a folder');
		done();
		return;
	}

	// remove drive on windows
	if (srcPath.indexOf(path.sep) > 0) {
		srcPath = srcPath.substring(srcPath.indexOf(path.sep));
	}

	console.log(' - static site folder: ' + srcPath);

	var siteName = argv.site;

	var request = serverUtils.getRequest();

	var siteId;
	serverUtils.loginToServer(server, request).then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		serverUtils.getSiteFolder(server, siteName)
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}
				if (!result.id) {
					console.log('ERROR: site ' + siteName + ' does not exist');
					return Promise.reject();
				}
				siteId = result.id;
				console.log(' - verify site');

				return _prepareStaticSite(srcPath);

			})
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}

				var uploadArgv = {
					path: result.localFolder,
					folder: 'site:' + siteName
				};
				return documentUtils.uploadFolder(uploadArgv, server);
			})
			.then(function (result) {
				console.log(' - static files uploaded');
				done(true);
			})
			.catch((error) => {
				done();
			});

	});
};

var _prepareStaticSite = function (srcPath) {
	return new Promise(function (resolve, reject) {
		serverUtils.paths(srcPath, function (err, paths) {
			if (err) {
				console.log(err);
				return resolve({
					err: 'err'
				});
			} else {
				try {
					if (paths.files.length === 0 && paths.dirs.length === 0) {
						console.log('ERROR: no file nor folder under ' + srcPath);
						return resolve({
							err: 'err'
						});
					}

					var buildDir = serverUtils.getBuildFolder(projectDir);
					if (!fs.existsSync(buildDir)) {
						fse.mkdirSync(buildDir);
					}

					var srcFolderName = srcPath.substring(srcPath.lastIndexOf(path.sep) + 1);
					var staticFolder = path.join(buildDir, 'static');
					if (fs.existsSync(staticFolder)) {
						fse.removeSync(staticFolder);
					}
					fse.mkdirSync(staticFolder);

					// get all sub folders including empty ones
					var subdirs = paths.dirs;
					for (var i = 0; i < subdirs.length; i++) {
						var subdir = subdirs[i];
						subdir = subdir.substring(srcPath.length + 1);
						fse.mkdirSync(path.join(staticFolder, subdir), {
							recursive: true
						});
					}

					// get all sub folders including empty ones
					var files = paths.files;

					for (var i = 0; i < files.length; i++) {
						var fileFolder = files[i];
						var fileFolder = fileFolder.substring(srcPath.length + 1);
						fileFolder = fileFolder.substring(0, fileFolder.lastIndexOf(path.sep));

						// create _files folder
						var filesFolder;
						if (serverUtils.endsWith(fileFolder, '_files') || serverUtils.endsWith(fileFolder, '_mobilefiles')) {
							filesFolder = path.join(staticFolder, fileFolder);
						} else {
							filesFolder = path.join(staticFolder, fileFolder, '_files');
						}
						
						if (!fs.existsSync(filesFolder)) {
							fse.mkdirSync(filesFolder, {
								recursive: true
							});
						}

						var fileName = files[i];
						fileName = fileName.substring(fileName.lastIndexOf(path.sep) + 1);

						// copy file
						fs.copyFileSync(files[i], path.join(filesFolder, fileName));
					}

					return resolve({
						localFolder: staticFolder
					});
				} catch (e) {
					console.log(e);
					return resolve({
						err: 'err'
					});
				}
			}
		});
	});
};

/**
 * Download static files from a site
 */
module.exports.downloadStaticSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}

	var siteName = argv.site;

	var targetPath;
	var saveToSrc = false;
	if (argv.folder) {
		targetPath = argv.folder;
		if (!path.isAbsolute(targetPath)) {
			targetPath = path.join(projectDir, targetPath);
		}
		targetPath = path.resolve(targetPath);
		if (!fs.existsSync(targetPath)) {
			console.log('ERROR: folder ' + targetPath + ' does not exist');
			done();
			return;
		}
		if (!fs.statSync(targetPath).isDirectory()) {
			console.log('ERROR: ' + targetPath + ' is not a folder');
			done();
			return;
		}
	} else {
		targetPath = path.join(documentsSrcDir, siteName, 'static');
		saveToSrc = true;
	}
	console.log(' - local folder ' + targetPath);

	var siteName = argv.site;

	var request = serverUtils.getRequest();

	var siteId;
	serverUtils.loginToServer(server, request).then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		serverUtils.getSiteFolder(server, siteName)
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}
				if (!result.id) {
					console.log('ERROR: site ' + siteName + ' does not exist');
					return Promise.reject();
				}
				siteId = result.id;
				console.log(' - verify site');

				return serverRest.findFolderHierarchy({
					server: server,
					parentID: siteId,
					folderPath: 'static'
				});
			})
			.then(function (result) {
				if (!result || result.err) {
					console.log('ERROR: site ' + siteName + ' does not have static files');
					return Promise.reject();
				}

				if (saveToSrc) {
					if (fs.existsSync(targetPath)) {
						fse.removeSync(targetPath);
					}
					fse.mkdirSync(targetPath, {
						recursive: true
					});
				}

				var downloadArgv = {
					folder: targetPath,
					path: 'site:' + siteName + '/static'
				};

				return documentUtils.downloadFolder(downloadArgv, server, true, false);

			})
			.then(function (result) {
				return _processDownloadedStaticSite(targetPath);
			})
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}

				console.log(' - static files saved to ' + targetPath);

				done(true);
			})
			.catch((error) => {
				done();
			});

	});
};

var _processDownloadedStaticSite = function (srcPath) {
	return new Promise(function (resolve, reject) {
		serverUtils.paths(srcPath, function (err, paths) {
			if (err) {
				console.log(err);
				return resolve({
					err: 'err'
				});
			} else {
				try {
					if (paths.files.length === 0 && paths.dirs.length === 0) {
						console.log('ERROR: no file nor folder under ' + srcPath);
						return resolve({
							err: 'err'
						});
					}

					var files = paths.files;
					for (var i = 0; i < files.length; i++) {
						var filePath = files[i];
						var fileFolder = filePath.substring(0, filePath.lastIndexOf(path.sep));
						var fileName = filePath.substring(filePath.lastIndexOf(path.sep) + 1);

						// remove _files folder
						if (serverUtils.endsWith(fileFolder, '_files')) {
							var parentFolder = fileFolder.substring(0, fileFolder.length - 6);
							// console.log('move: ' + files[i] + ' =====> ' + parentFolder);
							fse.moveSync(filePath, path.join(parentFolder, fileName));
						}
					}

					var subdirs = paths.dirs;
					for (var i = 0; i < subdirs.length; i++) {
						var subdir = subdirs[i];
						if (serverUtils.endsWith(subdir, '_files')) {
							fse.removeSync(subdir);
							// console.log('remove ' + subdir);
						}
					}

					return resolve({});
				} catch (e) {
					console.log(e);
					return resolve({
						err: 'err'
					});
				}
			}
		});
	});
};

/**
 * Delete static files from a site
 */
module.exports.deleteStaticSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}

	var siteName = argv.site;

	var request = serverUtils.getRequest();

	var siteId;
	serverUtils.loginToServer(server, request).then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		serverUtils.getSiteFolder(server, siteName)
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}
				if (!result.id) {
					console.log('ERROR: site ' + siteName + ' does not exist');
					return Promise.reject();
				}
				siteId = result.id;
				console.log(' - verify site');

				return serverRest.findFolderHierarchy({
					server: server,
					parentID: siteId,
					folderPath: 'static'
				});
			})
			.then(function (result) {
				if (!result || result.err) {
					console.log('ERROR: site ' + siteName + ' does not have static files');
					return Promise.reject();
				}

				var deleteArgv = {
					path: 'site:' + siteName + '/static'
				};

				return documentUtils.deleteFolder(deleteArgv, server);

			})
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}

				console.log(' - static files deleted');

				done(true);
			})
			.catch((error) => {
				done();
			});

	});
};

/**
 * Delete static files from a site
 */
module.exports.refreshPrerenderCache = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}

	var siteName = argv.site;

	var request = serverUtils.getRequest();

	var siteId;
	serverUtils.loginToServer(server, request).then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		/*
		serverUtils.getTenantConfig(server)
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}

				var isSitesPrerenderEnabled = result.IsSitesPrerenderEnabled ? result.IsSitesPrerenderEnabled.toLowerCase() === 'true' : false;
				// console.log(' - isSitesPrerenderEnabled: ' + isSitesPrerenderEnabled);
				if (!isSitesPrerenderEnabled) {
					console.log('ERROR: Pre-render is not enabled');
					return Promise.reject();
				}
			*/
		serverUtils.getSiteFolder(server, siteName)
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}
				if (!result.id) {
					console.log('ERROR: site ' + siteName + ' does not exist');
					return Promise.reject();
				}
				siteId = result.id;
				console.log(' - verify site');

				return sitesRest.refreshSiteContent({
					server: server,
					id: siteId,
					name: siteName
				});
			})
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}

				console.log(result);

				done(true);
			})
			.catch((error) => {
				done();
			});

	});
};

var _importTemplateSCS = function (localhost, request, name) {
	return new Promise(function (resolve, reject) {
		url = localhost + '/documents/web?IdcService=SCS_IMPORT_TEMPLATE_PACKAGE';
		request.post(url, function (err, response, body) {
			var data;
			try {
				data = JSON.parse(body);
			} catch (e) {}

			if (!data || data.err || !data.LocalData || data.LocalData.StatusCode !== '0') {
				console.log(' - failed to import ' + (data && data.LocalData ? ('- ' + data.LocalData.StatusMessage) : err));
				return resolve({
					err: 'err'
				});
			}
			if (data.LocalData.ImportConflicts) {
				var conflict = data.ResultSets.ImportConflictsResultSet;
				console.log(' - failed to import: ImportConflicts');
				// console.log(conflict);
				if (data.ResultSets.ImportConflictsResultSet) {
					var conflictIdx, nameIdx, ownerIdx, resolutionIdx;
					var fields = data.ResultSets.ImportConflictsResultSet.fields || [];
					var rows = data.ResultSets.ImportConflictsResultSet.rows;
					for (var i = 0; i < fields.length; i++) {
						if (fields[i].name === 'conflict') {
							conflictIdx = i;
						} else if (fields[i].name === 'name') {
							nameIdx = i;
						} else if (fields[i].name === 'fCreatorLoginName') {
							ownerIdx = i;
						} else if (fields[i].name === 'resolution') {
							resolutionIdx = i;
						}
					}

					for (var i = 0; i < rows.length; i++) {
						var msg = rows[i][conflictIdx] + ': ' + rows[i][nameIdx] + ' owned by ' + rows[i][ownerIdx] + ' ' + rows[i][resolutionIdx];
						console.log('   ' + msg);
					}
				}
				return resolve({
					err: 'err'
				});
			}

			var jobId = data.LocalData.JobID;
			var importTempStatusPromise = serverUtils.getTemplateImportStatus(request, localhost, jobId);
			importTempStatusPromise.then(function (data) {
				var success = false;
				// console.log(data);
				if (data && data.LocalData) {
					if (data.LocalData.StatusCode !== '0') {
						console.log(' - failed to import ' + name + ': ' + importResult.LocalData.StatusMessage);
					} else if (data.LocalData.ImportConflicts) {
						// console.log(data.LocalData);
						console.log(' - failed to import ' + name + ': the template already exists and you do not have privilege to override it');
					} else if (data.JobInfo && data.JobInfo.JobStatus && data.JobInfo.JobStatus === 'FAILED') {
						console.log(' - failed to import: ' + data.JobInfo.JobMessage);
					} else {
						success = true;
						console.log(' - template ' + name + ' imported');
					}
				} else {
					console.log(' - failed to import ' + name);
				}
				return success ? resolve({}) : resolve({
					err: 'err'
				});
			});
		});
	});
};

/**
 * create non-MLS enterprise site
 */
module.exports.migrateSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server;
	if (serverName) {
		server = serverUtils.verifyServer(serverName, projectDir);
		if (!server || !server.valid) {
			done();
			return;
		}
		if (server.env !== 'pod_ic') {
			console.log('ERROR: server ' + server.url + ' is not a valid source to migrate site');
			done();
			return;
		}
	}

	var destServerName = argv.destination;
	var destServer = serverUtils.verifyServer(destServerName, projectDir);
	if (!destServer || !destServer.valid) {
		done();
		return;
	}
	if (destServer.env === 'pod_ic') {
		console.log('ERROR: server ' + destServer.url + ' is not a valid destination to migrate site');
		done();
		return;
	}

	var tempPath = argv.template;
	if (tempPath) {
		if (!path.isAbsolute(tempPath)) {
			tempPath = path.join(projectDir, tempPath);
		}
		tempPath = path.resolve(tempPath);

		if (!fs.existsSync(tempPath)) {
			console.log('ERROR: file ' + tempPath + ' does not exist');
			done();
			return;
		}
		if (fs.statSync(tempPath).isDirectory()) {
			console.log('ERROR: ' + tempPath + ' is not a file');
			done();
			return;
		}
	}

	var srcSiteName = argv.site;
	var templateName = srcSiteName + serverUtils.createGUID();
	templateName = templateName.substring(0, 40);
	var repositoryName = argv.repository;
	var siteName = argv.name || srcSiteName;
	var description = argv.description;
	var sitePrefix = argv.sitePrefix || siteName.toLowerCase();
	sitePrefix = sitePrefix.substring(0, 15);

	var request = serverUtils.getRequest();

	var folderId = 'self';
	var repositoryId;
	var fileName, fileId;
	var cecVersion;

	var loginPromise = serverUtils.loginToServer(destServer, request);
	loginPromise.then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server ' + destServer.url);
			done();
			return;
		}

		var express = require('express');
		var app = express();

		var port = '9191';
		var localhost = 'http://localhost:' + port;

		var idcToken;

		var auth = serverUtils.getRequestAuth(destServer);

		var template, templateGUID;

		app.get('/*', function (req, res) {
			// console.log('GET: ' + req.url);
			if (req.url.indexOf('/documents/') >= 0 || req.url.indexOf('/content/') >= 0) {
				var url = destServer.url + req.url;

				var options = {
					url: url,
					auth: auth
				};

				if (destServer.cookies) {
					options.headers = {
						Cookie: server.cookies
					};
				}

				request(options).on('response', function (response) {
						// fix headers for cross-domain and capitalization issues
						serverUtils.fixHeaders(response, res);
					})
					.on('error', function (err) {
						console.log('ERROR: GET request failed: ' + req.url);
						console.log(error);
						return resolve({
							err: 'err'
						});
					})
					.pipe(res);

			} else {
				console.log('ERROR: GET request not supported: ' + req.url);
				res.write({});
				res.end();
			}
		});
		app.post('/documents/web', function (req, res) {
			// console.log('POST: ' + req.url);

			if (req.url.indexOf('SCS_IMPORT_TEMPLATE_PACKAGE') > 0) {
				var importUrl = destServer.url + '/documents/web?IdcService=SCS_IMPORT_TEMPLATE_PACKAGE';
				var data = {
					'item': 'fFileGUID:' + fileId,
					'idcToken': idcToken,
					'useBackgroundThread': true,
					'ThemeConflictResolution': 'overwrite',
					'TemplateConflictResolution': 'overwrite',
					'DefaultComponentConflictResolution': true,
					'allowCrossTenant': true
				};
				var postData = {
					method: 'POST',
					url: importUrl,
					'auth': auth,
					'form': data
				};
				if (destServer.cookies) {
					postData.headers = {
						Cookie: server.cookies
					};
				}
				// console.log(postData);
				request(postData).on('response', function (response) {
						// fix headers for cross-domain and capitalization issues
						serverUtils.fixHeaders(response, res);
					})
					.on('error', function (err) {
						res.write({
							err: err
						});
						res.end();
					})
					.pipe(res)
					.on('finish', function (err) {
						// console.log(' - template import finished');
						res.end();
					});
			} else if (req.url.indexOf('SCS_COPY_SITES') > 0) {
				var url = destServer.url + req.url;
				var repositoryPrefix = cecVersion && semver.gte(semver.coerce(cecVersion), '19.4.3') ? 'arCaaSGUID' : 'fFolderGUID';
				var formData = {
					'idcToken': idcToken,
					'names': siteName,
					'descriptions': description,
					'items': 'fFolderGUID:' + templateGUID,
					'isEnterprise': '1',
					'repository': repositoryPrefix + ':' + repositoryId,
					'slugPrefix': sitePrefix,
					'useBackgroundThread': 1,
					'doPreserveCaaSGUID': 1
				};

				var postData = {
					method: 'POST',
					url: url,
					auth: auth,
					formData: formData
				};
				if (destServer.cookies) {
					postData.headers = {
						Cookie: server.cookies
					};
				}
				request(postData).on('response', function (response) {
						// fix headers for cross-domain and capitalization issues
						serverUtils.fixHeaders(response, res);
					})
					.on('error', function (err) {
						console.log('ERROR: Failed to ' + action + ' site');
						console.log(error);
						return resolve({
							err: 'err'
						});
					})
					.pipe(res)
					.on('finish', function (err) {
						res.end();
					});

			} else {
				console.log('ERROR: POST request not supported: ' + req.url);
				res.write({});
				res.end();
			}
		});

		localServer = app.listen(0, function () {
			port = localServer.address().port;
			localhost = 'http://localhost:' + port;
			localServer.setTimeout(0);

			// verify site
			sitesRest.resourceExist({
					server: destServer,
					type: 'sites',
					name: siteName
				})
				.then(function (result) {
					if (result && result.id) {
						console.log('ERROR: site ' + siteName + ' already exists');
						return Promise.reject();
					}

					// verify repository
					return serverRest.getRepositoryWithName({
						server: destServer,
						name: repositoryName
					});
				})
				.then(function (result) {
					if (!result || result.err || !result.data) {
						console.log('ERROR: repository ' + repositoryName + ' does not exist');
						return Promise.reject();
					}

					repositoryId = result.data && result.data.id;
					console.log(' - verify repository (Id: ' + repositoryId + ')');

					var createTemplatePromises = [];
					if (!tempPath) {
						var createTemplateArgv = {
							projectDir: projectDir,
							server: server,
							name: templateName,
							siteName: srcSiteName,
							includeUnpublishedAssets: true
						};

						// create template on the source server and download
						createTemplatePromises.push(templateUtils.createTemplateFromSiteAndDownloadSCS(createTemplateArgv));
					}

					return Promise.all(createTemplatePromises);
				})
				.then(function (results) {
					if (!tempPath) {
						if (!results || !results[0] || results[0].err) {
							return Promise.reject();
						}
					}

					var templatePath;
					if (tempPath) {
						fileName = tempPath.substring(tempPath.lastIndexOf(path.sep) + 1);
						templateName = fileName.substring(0, fileName.indexOf('.'));
						templatePath = tempPath;
						console.log(' - template file ' + templatePath + ' name ' + templateName);
					} else {
						fileName = templateName + '.zip';
						var destdir = path.join(projectDir, 'dist');
						if (!fs.existsSync(destdir)) {
							fs.mkdirSync(destdir);
						}
						templatePath = path.join(destdir, fileName);
						if (!fs.existsSync(templatePath)) {
							console.log('ERROR: failed to download template ' + templateName);
							return Promise.reject();
						}
					}

					// upload template file
					return serverRest.createFile({
						server: destServer,
						parentID: folderId,
						filename: fileName,
						contents: fs.readFileSync(templatePath)
					});
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}
					fileId = result.id;
					console.log(' - file ' + fileName + ' uploaded to Home folder (Id: ' + result.id + ' version:' + result.version + ')');

					return serverUtils.getIdcToken(destServer);
				})
				.then(function (result) {
					idcToken = result && result.idcToken;
					if (!idcToken) {
						console.log('ERROR: failed to get idcToken');
						return Promise.reject();
					}
					// console.log(' - get idcToken: ' + idcToken);

					return _importTemplateSCS(localhost, request, templateName);
				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}

					return sitesRest.getTemplate({
						server: destServer,
						name: templateName
					});

				})
				.then(function (result) {
					if (!result || result.err) {
						return Promise.reject();
					}

					templateGUID = result.id;

					return serverUtils.getServerVersion(request, destServer);
				})
				.then(function (result) {
					cecVersion = result && result.version;

					return serverUtils.getIdcToken(destServer);
				})
				.then(function (result) {
					// re-fetch token
					if (result && result.idcToken) {
						idcToken = result && result.idcToken;
					}
					return _postOneIdcService(request, localhost, destServer, 'SCS_COPY_SITES', 'create site', idcToken);
				})
				.then(function (result) {
					if (result.err) {
						return Promise.reject();
					}

					// delete template file
					return serverRest.deleteFile({
						server: destServer,
						fFileGUID: fileId
					});

				})
				.then(function (result) {
					// delete template
					return sitesRest.deleteTemplate({
						server: destServer,
						name: templateName,
						hard: true,
						showError: false
					});
				})
				.then(function (result) {
					console.log(' - site ' + siteName + ' created on ' + destServer.url);
					_cmdEnd(done, true);
				})
				.catch((error) => {
					if (error) {
						console.log(error);
					}
					_cmdEnd(done);
				});
		});
	});
};


//////////////////////////////////////////////////////////////////////////
//    Sync server event handlers
//////////////////////////////////////////////////////////////////////////

module.exports.syncControlSiteSite = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var srcServer = argv.server;
	console.log(' - source server: ' + srcServer.url);

	var destServer = argv.destination;
	console.log(' - destination server: ' + destServer.url);

	var siteId = argv.id;
	var siteName = argv.name;
	var action = argv.action || 'publish';

	var siteName;

	var request = serverUtils.getRequest();

	serverUtils.loginToServer(srcServer, request).then(function (result) {
		if (!result.status) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		// verify the site
		sitesRest.getSite({
				server: destServer,
				name: siteName
			})
			.then(function (result) {
				if (!result || result.err) {
					return Promise.reject();
				}

				_controlSiteREST(request, destServer, action, siteName, done);
			})
			.catch((error) => {
				done();
			});
	});

};